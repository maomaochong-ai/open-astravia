import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type AgentRpcExecutable,
	type AgentRpcFixture,
	type AgentRpcProcess,
	buildAgentRpcExecutable,
	createAgentRpcFixture,
	readSessionFile,
	startAgentRpc,
} from "./support/agent-rpc-test-process.js";
import { startOpenAiResponsesTestServer, textResponseEvents } from "./support/openai-responses-test-server.js";

let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
});

afterAll(async () => {
	await executable.dispose();
});

describe("Agent Runtime session replacement admission contract", () => {
	it("binds a prompt queued after switch_session to the target identity", async () => {
		const observation = await runSwitchThenPrompt();
		expect(observation).toEqual({
			finalIdentityIsTarget: true,
			promptResponseCount: 1,
			promptPersistedInSource: false,
			promptPersistedInTarget: true,
			promptReachedProvider: true,
			providerRequestCount: 1,
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			terminalOutcomeCount: 1,
			transitionResponseCount: 1,
		});
	}, 30_000);

	it("binds a prompt queued after a failed switch_session back to the source identity", async () => {
		const observation = await runFailedSwitchThenPrompt();
		expect(observation).toEqual({
			finalIdentityIsSource: true,
			promptResponseCount: 1,
			promptPersistedInSource: true,
			promptPersistedInTarget: false,
			promptReachedProvider: true,
			providerRequestCount: 1,
			sourceOwnershipHeld: true,
			targetOwnershipHeld: true,
			terminalOutcomeCount: 1,
			transitionFailed: true,
			transitionResponseCount: 1,
		});
	}, 40_000);

	it("binds a prompt queued after fork to the fork identity", async () => {
		const observation = await runForkThenPrompt();
		expect(observation).toEqual({
			finalIdentityChanged: true,
			forkSucceeded: true,
			promptResponseCount: 1,
			promptPersistedInSource: false,
			promptPersistedInTarget: true,
			promptReachedProvider: true,
			providerRequestCount: 2,
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			terminalOutcomeCount: 1,
			transitionResponseCount: 1,
		});
	}, 40_000);

	it("linearizes consecutive switch_session commands before admitting the next prompt", async () => {
		const observation = await runConsecutiveSwitchesThenPrompt();
		expect(observation).toEqual({
			finalIdentityIsLastTarget: true,
			intermediateOwnershipReleased: true,
			lastTargetOwnershipHeld: true,
			promptPersistedInIntermediate: false,
			promptPersistedInLastTarget: true,
			promptPersistedInSource: false,
			promptReachedProvider: true,
			promptResponseCount: 1,
			providerRequestCount: 1,
			sourceOwnershipReleased: true,
			terminalOutcomeCount: 1,
			transitionResponseCount: 2,
		});
	}, 40_000);

	it("runs an Extension command queued after switch_session against the target identity", async () => {
		const observation = await runSwitchThenExtensionCommand();
		expect(observation).toEqual({
			commandCompleted: true,
			finalIdentityChangedAgain: true,
			firstPreviousIdentityWasSource: true,
			promptResponseCount: 1,
			secondPreviousIdentityWasTarget: true,
			switchReasons: ["resume", "new"],
			transitionResponseCount: 1,
		});
	}, 40_000);
});

interface SuccessfulAdmissionObservation {
	readonly finalIdentityIsTarget: boolean;
	readonly promptResponseCount: number;
	readonly promptPersistedInSource: boolean;
	readonly promptPersistedInTarget: boolean;
	readonly promptReachedProvider: boolean;
	readonly providerRequestCount: number;
	readonly sourceOwnershipReleased: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly terminalOutcomeCount: number;
	readonly transitionResponseCount: number;
}

interface FailedAdmissionObservation {
	readonly finalIdentityIsSource: boolean;
	readonly promptResponseCount: number;
	readonly promptPersistedInSource: boolean;
	readonly promptPersistedInTarget: boolean;
	readonly promptReachedProvider: boolean;
	readonly providerRequestCount: number;
	readonly sourceOwnershipHeld: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly terminalOutcomeCount: number;
	readonly transitionFailed: boolean;
	readonly transitionResponseCount: number;
}

interface ForkAdmissionObservation {
	readonly finalIdentityChanged: boolean;
	readonly forkSucceeded: boolean;
	readonly promptResponseCount: number;
	readonly promptPersistedInSource: boolean;
	readonly promptPersistedInTarget: boolean;
	readonly promptReachedProvider: boolean;
	readonly providerRequestCount: number;
	readonly sourceOwnershipReleased: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly terminalOutcomeCount: number;
	readonly transitionResponseCount: number;
}

interface ConsecutiveAdmissionObservation {
	readonly finalIdentityIsLastTarget: boolean;
	readonly intermediateOwnershipReleased: boolean;
	readonly lastTargetOwnershipHeld: boolean;
	readonly promptPersistedInIntermediate: boolean;
	readonly promptPersistedInLastTarget: boolean;
	readonly promptPersistedInSource: boolean;
	readonly promptReachedProvider: boolean;
	readonly promptResponseCount: number;
	readonly providerRequestCount: number;
	readonly sourceOwnershipReleased: boolean;
	readonly terminalOutcomeCount: number;
	readonly transitionResponseCount: number;
}

interface ExtensionAdmissionObservation {
	readonly commandCompleted: boolean;
	readonly finalIdentityChangedAgain: boolean;
	readonly firstPreviousIdentityWasSource: boolean;
	readonly promptResponseCount: number;
	readonly secondPreviousIdentityWasTarget: boolean;
	readonly switchReasons: readonly string[];
	readonly transitionResponseCount: number;
}

interface SessionSwitchAuditRecord {
	readonly reason: string;
	readonly previousSessionFile?: string;
}

async function runSwitchThenPrompt(): Promise<SuccessfulAdmissionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const prompt = "queued-after-switch-runtime";
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "events",
		events: textResponseEvents("queued switch prompt completed"),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await process.request("switch-admission-source", "get_state"));
		const targetPath = await createTargetAndRestoreSource(process, sourcePath, "switch-admission");

		const mark = process.mark();
		process.send({ id: "switch-admission-transition", type: "switch_session", sessionPath: targetPath });
		process.send({ id: "switch-admission-prompt", type: "prompt", message: prompt });
		await waitForResponse(process, mark, "switch-admission-transition", "switch_session");
		await waitForResponse(process, mark, "switch-admission-prompt", "prompt");
		await process.waitFor((frame) => frame.type === "agent_end", mark, 10_000);
		const finalPath = readSessionFile(await process.request("switch-admission-final", "get_state"));

		return {
			finalIdentityIsTarget: finalPath === targetPath,
			promptResponseCount: countResponses(process, mark, "switch-admission-prompt", "prompt"),
			promptPersistedInSource: await fileContains(sourcePath, prompt),
			promptPersistedInTarget: await fileContains(targetPath, prompt),
			promptReachedProvider: server.requests.some((request) => request.rawBody.includes(prompt)),
			providerRequestCount: server.requests.length,
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			terminalOutcomeCount: countPromptTerminalOutcomes(process, mark, "switch-admission-prompt"),
			transitionResponseCount: countResponses(process, mark, "switch-admission-transition", "switch_session"),
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runFailedSwitchThenPrompt(): Promise<FailedAdmissionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let sourceProcess: AgentRpcProcess | undefined;
	let targetProcess: AgentRpcProcess | undefined;
	const prompt = "queued-after-failed-switch-runtime";
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "events",
		events: textResponseEvents("queued failed-switch prompt completed"),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		sourceProcess = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await sourceProcess.request("failed-admission-source", "get_state"));
		const targetPath = await createTargetAndRestoreSource(sourceProcess, sourcePath, "failed-admission");
		targetProcess = startAgentRpc(executable, fixture, { extraArgs: ["--session", targetPath] });
		await targetProcess.request("failed-admission-holder", "get_state");

		const mark = sourceProcess.mark();
		sourceProcess.send({
			id: "failed-admission-transition",
			type: "switch_session",
			sessionPath: targetPath,
		});
		sourceProcess.send({ id: "failed-admission-prompt", type: "prompt", message: prompt });
		const transition = await waitForResponse(sourceProcess, mark, "failed-admission-transition", "switch_session");
		await waitForResponse(sourceProcess, mark, "failed-admission-prompt", "prompt");
		await sourceProcess.waitFor((frame) => frame.type === "agent_end", mark, 10_000);
		const finalPath = readSessionFile(await sourceProcess.request("failed-admission-final", "get_state"));

		return {
			finalIdentityIsSource: finalPath === sourcePath,
			promptResponseCount: countResponses(sourceProcess, mark, "failed-admission-prompt", "prompt"),
			promptPersistedInSource: await fileContains(sourcePath, prompt),
			promptPersistedInTarget: await fileContains(targetPath, prompt),
			promptReachedProvider: server.requests.some((request) => request.rawBody.includes(prompt)),
			providerRequestCount: server.requests.length,
			sourceOwnershipHeld: existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			terminalOutcomeCount: countPromptTerminalOutcomes(sourceProcess, mark, "failed-admission-prompt"),
			transitionFailed: transition.success === false,
			transitionResponseCount: countResponses(sourceProcess, mark, "failed-admission-transition", "switch_session"),
		};
	} finally {
		await sourceProcess?.close();
		await targetProcess?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runForkThenPrompt(): Promise<ForkAdmissionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const seedPrompt = "fork-admission-seed-runtime";
	const queuedPrompt = "queued-after-fork-runtime";
	const server = await startOpenAiResponsesTestServer((_request, index) => ({
		kind: "events",
		events: textResponseEvents(index === 0 ? "fork seed completed" : "queued fork prompt completed"),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await process.request("fork-admission-source", "get_state"));
		const seedMark = process.mark();
		await process.request("fork-admission-seed", "prompt", { message: seedPrompt });
		await process.waitFor((frame) => frame.type === "agent_end", seedMark, 10_000);
		const messages = await process.request("fork-admission-messages", "get_fork_messages");
		const entryId = readForkEntryId(messages, seedPrompt);

		const mark = process.mark();
		process.send({ id: "fork-admission-transition", type: "fork", entryId });
		process.send({ id: "fork-admission-prompt", type: "prompt", message: queuedPrompt });
		const transition = await waitForResponse(process, mark, "fork-admission-transition", "fork");
		await waitForResponse(process, mark, "fork-admission-prompt", "prompt");
		await process.waitFor((frame) => frame.type === "agent_end", mark, 10_000);
		const targetPath = readSessionFile(await process.request("fork-admission-final", "get_state"));

		return {
			finalIdentityChanged: targetPath !== sourcePath,
			forkSucceeded: transition.success === true,
			promptResponseCount: countResponses(process, mark, "fork-admission-prompt", "prompt"),
			promptPersistedInSource: await fileContains(sourcePath, queuedPrompt),
			promptPersistedInTarget: await fileContains(targetPath, queuedPrompt),
			promptReachedProvider: server.requests.some((request) => request.rawBody.includes(queuedPrompt)),
			providerRequestCount: server.requests.length,
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			terminalOutcomeCount: countPromptTerminalOutcomes(process, mark, "fork-admission-prompt"),
			transitionResponseCount: countResponses(process, mark, "fork-admission-transition", "fork"),
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runConsecutiveSwitchesThenPrompt(): Promise<ConsecutiveAdmissionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const prompt = "queued-after-consecutive-switches-runtime";
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "events",
		events: textResponseEvents("queued consecutive-switch prompt completed"),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await process.request("consecutive-admission-source", "get_state"));
		await process.request("consecutive-admission-create-a", "new_session");
		const targetA = readSessionFile(await process.request("consecutive-admission-a", "get_state"));
		await process.request("consecutive-admission-create-b", "new_session");
		const targetB = readSessionFile(await process.request("consecutive-admission-b", "get_state"));
		await process.request("consecutive-admission-restore-source", "switch_session", { sessionPath: sourcePath });

		const mark = process.mark();
		process.send({ id: "consecutive-admission-switch-a", type: "switch_session", sessionPath: targetA });
		process.send({ id: "consecutive-admission-switch-b", type: "switch_session", sessionPath: targetB });
		process.send({ id: "consecutive-admission-prompt", type: "prompt", message: prompt });
		await waitForResponse(process, mark, "consecutive-admission-switch-a", "switch_session");
		await waitForResponse(process, mark, "consecutive-admission-switch-b", "switch_session");
		await waitForResponse(process, mark, "consecutive-admission-prompt", "prompt");
		await process.waitFor((frame) => frame.type === "agent_end", mark, 10_000);
		const finalPath = readSessionFile(await process.request("consecutive-admission-final", "get_state"));

		return {
			finalIdentityIsLastTarget: finalPath === targetB,
			intermediateOwnershipReleased: !existsSync(ownershipPath(targetA)),
			lastTargetOwnershipHeld: existsSync(ownershipPath(targetB)),
			promptPersistedInIntermediate: await fileContains(targetA, prompt),
			promptPersistedInLastTarget: await fileContains(targetB, prompt),
			promptPersistedInSource: await fileContains(sourcePath, prompt),
			promptReachedProvider: server.requests.some((request) => request.rawBody.includes(prompt)),
			promptResponseCount: countResponses(process, mark, "consecutive-admission-prompt", "prompt"),
			providerRequestCount: server.requests.length,
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			terminalOutcomeCount: countPromptTerminalOutcomes(process, mark, "consecutive-admission-prompt"),
			transitionResponseCount: process
				.framesSince(mark)
				.filter(
					(frame) =>
						frame.type === "response" &&
						(frame.id === "consecutive-admission-switch-a" || frame.id === "consecutive-admission-switch-b") &&
						frame.success === true,
				).length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runSwitchThenExtensionCommand(): Promise<ExtensionAdmissionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	try {
		fixture = await createAgentRpcFixture();
		const auditPath = join(fixture.root, "runtime-replacement-extension-admission.jsonl");
		const extensionPath = join(fixture.root, "runtime-replacement-extension-admission.ts");
		await writeFile(
			extensionPath,
			`import { appendFileSync } from "node:fs";
			export default function(extension) {
				extension.on("session_switch", async (event) => {
					appendFileSync(${JSON.stringify(auditPath)}, JSON.stringify(event) + "\\n", "utf8");
				});
				extension.registerCommand("queued-session-new", {
					handler: async (_args, ctx) => {
						const result = await ctx.newSession();
						appendFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ type: "command_done", cancelled: result.cancelled }) + "\\n", "utf8");
					},
				});
			}`,
			"utf8",
		);
		process = startAgentRpc(executable, fixture, { extraArgs: ["--extension", extensionPath] });
		const sourcePath = readSessionFile(await process.request("extension-admission-source", "get_state"));
		const targetPath = await createTargetAndRestoreSource(process, sourcePath, "extension-admission");
		await writeFile(auditPath, "", "utf8");

		const mark = process.mark();
		process.send({ id: "extension-admission-switch", type: "switch_session", sessionPath: targetPath });
		process.send({ id: "extension-admission-command", type: "prompt", message: "/queued-session-new" });
		await waitForResponse(process, mark, "extension-admission-switch", "switch_session");
		await waitForResponse(process, mark, "extension-admission-command", "prompt");
		const records = await waitForAuditRecords(auditPath, 3);
		const finalPath = readSessionFile(await process.request("extension-admission-final", "get_state"));
		const switches = records.filter(isSessionSwitchAuditRecord);
		const command = records.find(
			(record) => isRecord(record) && record.type === "command_done" && record.cancelled === false,
		);

		return {
			commandCompleted: command !== undefined,
			finalIdentityChangedAgain: finalPath !== sourcePath && finalPath !== targetPath,
			firstPreviousIdentityWasSource: switches[0]?.previousSessionFile === sourcePath,
			promptResponseCount: countResponses(process, mark, "extension-admission-command", "prompt"),
			secondPreviousIdentityWasTarget: switches[1]?.previousSessionFile === targetPath,
			switchReasons: switches.map(({ reason }) => reason),
			transitionResponseCount: countResponses(process, mark, "extension-admission-switch", "switch_session"),
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
	}
}

async function createTargetAndRestoreSource(
	process: AgentRpcProcess,
	sourcePath: string,
	prefix: string,
): Promise<string> {
	await process.request(`${prefix}-create-target`, "new_session");
	const targetPath = readSessionFile(await process.request(`${prefix}-target`, "get_state"));
	await process.request(`${prefix}-restore-source`, "switch_session", { sessionPath: sourcePath });
	return targetPath;
}

async function waitForResponse(process: AgentRpcProcess, mark: number, id: string, command: string) {
	return process.waitFor(
		(frame) => frame.type === "response" && frame.id === id && frame.command === command,
		mark,
		10_000,
	);
}

async function fileContains(path: string, text: string): Promise<boolean> {
	return (await readFile(path, "utf8")).includes(text);
}

function countResponses(process: AgentRpcProcess, mark: number, id: string, command: string): number {
	return process
		.framesSince(mark)
		.filter((frame) => frame.type === "response" && frame.id === id && frame.command === command).length;
}

function countPromptTerminalOutcomes(process: AgentRpcProcess, mark: number, id: string): number {
	return process
		.framesSince(mark)
		.filter(
			(frame) =>
				frame.type === "agent_end" ||
				(frame.type === "response" && frame.id === id && frame.command === "prompt" && frame.success === false),
		).length;
}

function readForkEntryId(response: unknown, text: string): string {
	if (!isRecord(response)) throw new Error("Expected fork message response");
	const data = response.data;
	if (!isRecord(data) || !Array.isArray(data.messages)) throw new Error("Expected fork messages");
	for (const message of data.messages) {
		if (isRecord(message) && message.text === text && typeof message.entryId === "string") {
			return message.entryId;
		}
	}
	throw new Error(`Fork message was not found: ${text}`);
}

async function waitForAuditRecords(path: string, count: number): Promise<readonly unknown[]> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			const records = (await readFile(path, "utf8"))
				.trim()
				.split(/\r?\n/u)
				.filter(Boolean)
				.map((line) => JSON.parse(line) as unknown);
			if (records.length >= count) return records;
		} catch (error) {
			if (!isMissingFileError(error)) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Timed out waiting for ${count} audit records in ${path}`);
}

function isSessionSwitchAuditRecord(value: unknown): value is SessionSwitchAuditRecord {
	return (
		isRecord(value) &&
		value.type === "session_switch" &&
		typeof value.reason === "string" &&
		(value.previousSessionFile === undefined || typeof value.previousSessionFile === "string")
	);
}

function ownershipPath(sessionPath: string): string {
	return `${sessionPath}.owner.lock`;
}

function isMissingFileError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
