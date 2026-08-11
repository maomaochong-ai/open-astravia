import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, AssistantMessage, Model } from "@vetta/ai";
import type { ContextCompactionRecord, StoredSessionEvent } from "@vetta/runtime-core/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompactionPreparation, CompactionSettings } from "../../src/compaction/index.js";
import {
	CodingAgentMemoryRolloverOrchestrator,
	type CodingAgentMemoryRolloverPreparation,
	createCodingAgentMemoryRuntimeFeature,
} from "../../src/memory/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("CodingAgentMemoryRolloverOrchestrator", () => {
	it("freezes the prompt snapshot and preserves the legacy 70 percent threshold settings", async () => {
		const root = await temporaryRoot();
		const memoryFile = join(root, "MEMORY.md");
		await writeFile(memoryFile, "original memory", "utf8");
		const runtime = new CodingAgentMemoryRolloverOrchestrator({ memoryFile, cwd: root, memoryCharLimit: 123 });
		await writeFile(memoryFile, "changed after session start", "utf8");

		expect(runtime.readPromptMemory()).toEqual({
			enabled: true,
			file: memoryFile,
			snapshot: "original memory",
			charLimit: 123,
		});
		expect(runtime.adjustCompactionSettings(settings(), 100_001)).toEqual({
			enabled: true,
			reserveTokens: 30_001,
			minFreePercent: 30,
			keepRecentTokens: 20_000,
		});
	});

	it("keeps MEMORY flush failures best-effort and exposes only a generic continuation directive", async () => {
		const root = await temporaryRoot();
		const flushMemory = vi.fn(async () => {
			throw new Error("memory write failed");
		});
		const runtime = new CodingAgentMemoryRolloverOrchestrator({
			memoryFile: join(root, "MEMORY.md"),
			cwd: root,
			flushMemory,
		});
		const preparation = rolloverPreparation();

		await expect(runtime.beforeCompaction(preparation)).resolves.toBeUndefined();
		expect(flushMemory).toHaveBeenCalledWith({
			messages: preparation.preparation.messagesToSummarize,
			model: preparation.model,
			apiKey: preparation.apiKey,
			signal: preparation.signal,
			memoryFile: join(root, "MEMORY.md"),
			limit: 4_000,
		});
		expect(runtime.continuationAfterCompaction()).toEqual({ reason: "memory-rollover" });
	});

	it("writes the rollover section before continuation and one completed-turn journal line", async () => {
		const root = await temporaryRoot();
		const appendTurnJournal = vi.fn();
		const appendRolloverJournal = vi.fn();
		const runtime = new CodingAgentMemoryRolloverOrchestrator({
			memoryFile: join(root, "MEMORY.md"),
			cwd: root,
			appendTurnJournal,
			appendRolloverJournal,
		});
		const assistant = assistantMessage("completed response");

		await runtime.observe(messageEvent(assistant));
		await runtime.observe({
			type: "turn.transferred",
			sessionId: "source",
			turnId: "turn-1",
			targetSessionId: "target",
			reason: "memory-rollover",
			timestamp: 2,
		});
		await runtime.observe({
			type: "turn.continued",
			sessionId: "target",
			turnId: "turn-1",
			sourceSessionId: "source",
			snapshotId: "snapshot-1",
			reason: "memory-rollover",
			timestamp: 3,
		});
		await runtime.observe({
			type: "turn.completed",
			sessionId: "target",
			turnId: "turn-1",
			stopReason: "stop",
			timestamp: 4,
		});
		runtime.beforeContinuation(compactionRecord());

		expect(appendTurnJournal).toHaveBeenCalledOnce();
		expect(appendTurnJournal).toHaveBeenCalledWith(root, assistant);
		expect(appendRolloverJournal).toHaveBeenCalledWith(root, "rolled summary");
	});

	it("contributes the existing memory tool only through the memory feature", async () => {
		const root = await temporaryRoot();
		const runtime = new CodingAgentMemoryRolloverOrchestrator({
			memoryFile: join(root, "MEMORY.md"),
			cwd: root,
		});
		const feature = createCodingAgentMemoryRuntimeFeature(runtime.toolRegistration);
		const prepared = await feature.prepare({
			signal: new AbortController().signal,
		});
		const contribution = await prepared.contribute({
			profileId: "profile",
			signal: new AbortController().signal,
		});

		expect(contribution.tools?.map(({ name }) => name)).toEqual(["memory"]);
		expect(contribution.tools?.[0]?.description).toBe(runtime.toolRegistration.tool.description);
		await prepared.dispose();
	});
});

function settings(): CompactionSettings {
	return {
		enabled: true,
		reserveTokens: 10_000,
		minFreePercent: 20,
		keepRecentTokens: 20_000,
	};
}

function rolloverPreparation(): CodingAgentMemoryRolloverPreparation {
	const preparation: CompactionPreparation = {
		firstKeptEntryId: "entry-2",
		messagesToSummarize: [{ role: "user", content: "discarded context", timestamp: 1 }],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 70,
		fileOps: { read: new Set(), written: new Set(), edited: new Set() },
		settings: settings(),
	};
	return {
		preparation,
		model: MODEL,
		apiKey: "key",
		signal: new AbortController().signal,
	};
}

function compactionRecord(): ContextCompactionRecord {
	return {
		summary: "rolled summary",
		summaryMessage: { role: "user", content: "rolled summary", timestamp: 2 },
		firstKeptEntryId: "entry-2",
		tokensBefore: 70,
		reason: "threshold",
	};
}

function messageEvent(message: AssistantMessage): StoredSessionEvent {
	return {
		type: "message.appended",
		sessionId: "source",
		turnId: "turn-1",
		message,
		timestamp: 1,
	};
}

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-memory-rollover-"));
	temporaryRoots.push(root);
	return root;
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100,
	maxTokens: 20,
};
