import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type AgentRpcExecutable,
	buildAgentRpcExecutable,
	createAgentRpcFixture,
	readSessionFile,
	startAgentRpc,
} from "./support/agent-rpc-test-process.js";
import {
	LEGACY_EXECUTION_MARKERS,
	writeLegacyExecutionSessionFixture,
} from "./support/legacy-session-execution-fixture.js";
import { startOpenAiResponsesTestServer, textResponseEvents } from "./support/openai-responses-test-server.js";

describe("Historical session fork contract", () => {
	let executable: AgentRpcExecutable;

	beforeAll(async () => {
		executable = await buildAgentRpcExecutable();
	}, 30_000);

	afterAll(async () => {
		await executable.dispose();
	});

	it("forks mixed Import Seed and Event history with CLI re-edit semantics and resumes it after restart", async () => {
		const responses = ["Source response.", "Fork response.", "Restarted fork response."];
		const server = await startOpenAiResponsesTestServer((_request, index) => ({
			kind: "events",
			events: textResponseEvents(responses[index] ?? "Unexpected response."),
		}));
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		const legacy = await writeLegacyExecutionSessionFixture(fixture);
		let process = startAgentRpc(executable, fixture, {
			extraArgs: ["--session", legacy.sourcePath],
		});

		try {
			const initialState = await process.request("migrated-fork-state", "get_state");
			const parentPath = readSessionFile(initialState);
			expect(parentPath).not.toBe(legacy.sourcePath);

			let mark = process.mark();
			await process.request("migrated-fork-source-turn", "prompt", { message: "fork-source-turn" });
			await process.waitFor((frame) => frame.type === "agent_end", mark);

			const parentContentBeforeFork = await readFile(parentPath, "utf8");
			const forkEntryId = readUserMessageEntryId(parentContentBeforeFork, "fork-source-turn");

			await expect(process.request("migrated-fork-create", "fork", { entryId: forkEntryId })).resolves.toMatchObject(
				{
					data: { text: "fork-source-turn", cancelled: false },
				},
			);
			const forkState = await process.request("migrated-fork-child-state", "get_state");
			const forkPath = readSessionFile(forkState);
			expect(forkPath).not.toBe(parentPath);

			const forkAtCreation = describeForkFile(await readFile(forkPath, "utf8"));
			expect(forkAtCreation).toMatchObject({
				activeLeafId: "legacy-tail",
				allParentsResolved: true,
				allReferencesResolved: true,
				branchSummaryFromId: "legacy-custom-hidden",
				eventCount: 4,
				operationCount: 1,
				parentEntryId: forkEntryId,
				reason: "fork",
				sourceEntryId: forkEntryId,
				sourceSessionPath: parentPath,
			});
			expect(forkAtCreation.seedText).toContain(LEGACY_EXECUTION_MARKERS.compactionSummary);
			expect(forkAtCreation.seedText).toContain(LEGACY_EXECUTION_MARKERS.tail);
			expect(forkAtCreation.seedText).not.toContain(LEGACY_EXECUTION_MARKERS.abandonedBranch);

			mark = process.mark();
			await process.request("migrated-fork-child-turn", "prompt", { message: "fork-child-turn" });
			await process.waitFor((frame) => frame.type === "agent_end", mark);
			expect(server.requests[1]?.rawBody).toContain("fork-child-turn");
			expect(server.requests[1]?.rawBody).not.toContain("fork-source-turn");
			expect(server.requests[1]?.rawBody).not.toContain("Source response.");
			expect(await readFile(parentPath, "utf8")).toBe(parentContentBeforeFork);
			await process.close();

			process = startAgentRpc(executable, fixture, { extraArgs: ["--session", forkPath] });
			const resumedState = await process.request("migrated-fork-resumed-state", "get_state");
			expect(readSessionFile(resumedState)).toBe(forkPath);
			mark = process.mark();
			await process.request("migrated-fork-resumed-turn", "prompt", { message: "fork-restarted-turn" });
			await process.waitFor((frame) => frame.type === "agent_end", mark);

			expect(server.requests).toHaveLength(3);
			expect(server.requests[2]?.rawBody).toContain("fork-child-turn");
			expect(server.requests[2]?.rawBody).toContain("Fork response.");
			expect(server.requests[2]?.rawBody).not.toContain("fork-source-turn");
			expect(server.requests[2]?.rawBody).not.toContain("Source response.");
			expect(await readFile(legacy.sourcePath, "utf8")).toBe(legacy.content);
			expect(await readFile(parentPath, "utf8")).toBe(parentContentBeforeFork);
			expect(describeForkFile(await readFile(forkPath, "utf8"))).toMatchObject({
				allParentsResolved: true,
				allReferencesResolved: true,
				eventCount: 12,
			});
		} finally {
			await process.close();
			await fixture.dispose();
			await server.dispose();
		}
	}, 40_000);
});

function readUserMessageEntryId(content: string, text: string): string {
	for (const line of content.trim().split(/\r?\n/u)) {
		const record: unknown = JSON.parse(line);
		if (!isObject(record) || record.recordType !== "conversation.event") continue;
		const event = record.event;
		const documentEntry = record.documentEntry;
		if (!isObject(event) || !isObject(documentEntry) || event.type !== "message.appended") continue;
		const message = event.message;
		if (!isObject(message) || message.role !== "user" || readMessageText(message.content) !== text) continue;
		if (typeof documentEntry.id === "string") return documentEntry.id;
	}
	throw new Error(`Persisted user message was not found: ${text}`);
}

function readMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			if (!isObject(part) || part.type !== "text" || typeof part.text !== "string") return [];
			return [part.text];
		})
		.join("");
}

function describeForkFile(content: string): {
	readonly activeLeafId: unknown;
	readonly allParentsResolved: boolean;
	readonly allReferencesResolved: boolean;
	readonly branchSummaryFromId: unknown;
	readonly eventCount: number;
	readonly operationCount: number;
	readonly parentEntryId: unknown;
	readonly reason: unknown;
	readonly seedText: string;
	readonly sourceEntryId: unknown;
	readonly sourceSessionPath: unknown;
} {
	const records = content
		.trim()
		.split(/\r?\n/u)
		.map((line) => JSON.parse(line) as unknown);
	const header = records[0];
	const seed = records[1];
	if (!isObject(header) || !isObject(seed) || seed.recordType !== "conversation.continuation.seed") {
		throw new Error("Expected a fork continuation seed");
	}
	const entries = seed.entries;
	if (!Array.isArray(entries)) throw new Error("Expected fork seed entries");
	const seedEntryIds = new Set(
		entries.map((entry) => {
			if (!isObject(entry) || typeof entry.id !== "string") throw new Error("Invalid fork seed entry");
			return entry.id;
		}),
	);
	const knownEntryIds = new Set<string>();
	let activeLeafId = seed.activeLeafId;
	let allParentsResolved = true;
	for (const entry of entries) {
		if (!isObject(entry) || typeof entry.id !== "string") continue;
		if (typeof entry.parentId === "string" && !knownEntryIds.has(entry.parentId)) allParentsResolved = false;
		knownEntryIds.add(entry.id);
	}
	const allReferencesResolved = entries.every((entry) => {
		if (!isObject(entry)) return false;
		if (entry.type === "branch_summary") return entry.fromId === "root" || seedEntryIds.has(String(entry.fromId));
		if (entry.type === "compaction") return seedEntryIds.has(String(entry.firstKeptEntryId));
		if (entry.type === "label") return seedEntryIds.has(String(entry.targetId));
		return true;
	});
	let eventCount = 0;
	let operationCount = 0;
	for (const record of records) {
		if (!isObject(record)) continue;
		if (record.recordType === "conversation.event") {
			eventCount += 1;
			const documentEntry = record.documentEntry;
			if (!isObject(documentEntry) || typeof documentEntry.id !== "string") continue;
			if (typeof documentEntry.parentId === "string" && !knownEntryIds.has(documentEntry.parentId)) {
				allParentsResolved = false;
			}
			knownEntryIds.add(documentEntry.id);
			activeLeafId = documentEntry.id;
			continue;
		}
		if (record.recordType !== "conversation.document.operation") continue;
		operationCount += 1;
		const command = record.command;
		if (!isObject(command) || command.type !== "active_leaf.set") continue;
		activeLeafId = command.entryId;
	}
	return {
		activeLeafId,
		allParentsResolved,
		allReferencesResolved,
		branchSummaryFromId: entries.find((entry) => isObject(entry) && entry.type === "branch_summary")?.fromId,
		eventCount,
		operationCount,
		parentEntryId: header.parentEntryId,
		reason: seed.reason,
		seedText: JSON.stringify(seed.entries),
		sourceEntryId: seed.sourceEntryId,
		sourceSessionPath: seed.sourceSessionPath,
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
