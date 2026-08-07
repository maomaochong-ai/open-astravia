import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type AgentRpcExecutable,
	type AgentRpcFixture,
	type AgentRpcProcess,
	buildAgentRpcExecutable,
	createAgentRpcFixture,
	type RpcFrame,
	readSessionFile,
	type StartAgentRpcOptions,
	startAgentRpc,
} from "./support/agent-rpc-test-process.js";
import {
	startOpenAiResponsesTestServer,
	textResponseEvents,
	toolCallResponseEvents,
} from "./support/openai-responses-test-server.js";

const COMMAND_ADMISSION_HOST_OPTIONS = {
	enableHostBridge: true,
	scenario: "im-claw",
} as const satisfies StartAgentRpcOptions;
let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
});

afterAll(async () => {
	await executable.dispose();
});

describe("Agent Runtime RPC command admission contract", () => {
	it("preserves idle new_session and prompt ordering", async () => {
		const observation = await runIdleTransitionThenPrompt();
		expect(observation).toEqual({
			outcome: "completed",
			providerRequestCount: 1,
			queuedPromptReachedProvider: true,
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			identityChanged: true,
		});
	}, 30_000);

	it("keeps a prompt received during active-turn new_session off the released source session", async () => {
		const observation = await runTransitionThenPrompt();

		expect([
			{
				outcome: "failed",
				providerRequestClosed: true,
				providerRequestCount: 1,
				queuedPromptReachedProvider: false,
				sourceOwnershipReleased: true,
				targetOwnershipHeld: true,
				identityChanged: true,
			},
			completedAdmissionObservation(),
		]).toContainEqual(observation);
		expect(observation).toEqual(completedAdmissionObservation());
	}, 30_000);

	it("keeps abort scoped to the source turn while new_session is pending", async () => {
		const observation = await runTransitionThenAbort();
		expect(observation).toEqual({
			providerRequestClosed: true,
			providerRequestCount: 1,
			terminalKinds: [],
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			identityChanged: true,
		});
	}, 30_000);

	it("finishes an accepted session transition before transport cleanup", async () => {
		const observation = await runTransitionThenClose();
		expect(observation).toEqual({
			exitCode: 0,
			providerRequestClosed: true,
			providerRequestCount: 1,
			transitionResponseCount: 1,
			ownershipLockCount: 0,
		});
	}, 30_000);

	it("honors an asynchronous Extension shutdown request exactly once", async () => {
		const observation = await runExtensionShutdown();
		expect(observation).toEqual({
			exitCode: 0,
			promptResponseCount: 1,
			audit: ["handler-before", "handler-after", "session-shutdown"],
			ownershipLockCount: 0,
		});
	}, 30_000);

	it("settles an active Provider prompt before transport exit", async () => {
		const observation = await runHeldPromptThenClose();
		expect(observation).toEqual({
			exitCode: 0,
			providerRequestClosed: true,
			providerRequestCount: 1,
			promptResponseCount: 1,
			terminalOutcomeCount: 0,
			ownershipLockCount: 0,
		});
	}, 30_000);

	it("cancels an accepted memory flush before transport exit", async () => {
		const observation = await runHeldMemoryFlushThenClose();
		expect(observation).toEqual({
			exitCode: 0,
			providerRequestClosed: true,
			providerRequestCount: 2,
			flushResponseCount: 1,
			ownershipLockCount: 0,
		});
	}, 30_000);

	it("settles a prompt waiting on host_response before transport exit", async () => {
		const observation = await runHostBridgeThenClose();
		expect(observation).toEqual({
			exitCode: 0,
			providerRequestCount: 1,
			hostRequestCount: 1,
			promptResponseCount: 1,
			terminalOutcomeCount: 0,
			ownershipLockCount: 0,
		});
	}, 30_000);

	it("cancels a prompt waiting on extension_ui_response before transport exit", async () => {
		const observation = await runExtensionUiThenClose();
		expect(observation).toEqual({
			exitCode: 0,
			promptResponseCount: 1,
			extensionUiRequestCount: 1,
			audit: ["before", "after:false"],
			ownershipLockCount: 0,
		});
	}, 30_000);
});

interface AdmissionObservation {
	readonly outcome: "completed" | "failed";
	readonly providerRequestClosed: boolean;
	readonly providerRequestCount: number;
	readonly queuedPromptReachedProvider: boolean;
	readonly sourceOwnershipReleased: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly identityChanged: boolean;
}

interface IdleAdmissionObservation {
	readonly outcome: "completed" | "failed";
	readonly providerRequestCount: number;
	readonly queuedPromptReachedProvider: boolean;
	readonly sourceOwnershipReleased: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly identityChanged: boolean;
}

interface AbortDuringTransitionObservation {
	readonly providerRequestClosed: boolean;
	readonly providerRequestCount: number;
	readonly terminalKinds: readonly string[];
	readonly sourceOwnershipReleased: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly identityChanged: boolean;
}

interface TransitionShutdownObservation {
	readonly exitCode: number;
	readonly providerRequestClosed: boolean;
	readonly providerRequestCount: number;
	readonly transitionResponseCount: number;
	readonly ownershipLockCount: number;
}

interface ExtensionShutdownObservation {
	readonly exitCode: number;
	readonly promptResponseCount: number;
	readonly audit: readonly string[];
	readonly ownershipLockCount: number;
}

interface PromptShutdownObservation {
	readonly exitCode: number;
	readonly providerRequestClosed: boolean;
	readonly providerRequestCount: number;
	readonly promptResponseCount: number;
	readonly terminalOutcomeCount: number;
	readonly ownershipLockCount: number;
}

interface MemoryFlushShutdownObservation {
	readonly exitCode: number;
	readonly providerRequestClosed: boolean;
	readonly providerRequestCount: number;
	readonly flushResponseCount: number;
	readonly ownershipLockCount: number;
}

interface HostBridgeShutdownObservation {
	readonly exitCode: number;
	readonly providerRequestCount: number;
	readonly hostRequestCount: number;
	readonly promptResponseCount: number;
	readonly terminalOutcomeCount: number;
	readonly ownershipLockCount: number;
}

interface ExtensionUiShutdownObservation {
	readonly exitCode: number;
	readonly promptResponseCount: number;
	readonly extensionUiRequestCount: number;
	readonly audit: readonly string[];
	readonly ownershipLockCount: number;
}

async function runIdleTransitionThenPrompt(): Promise<IdleAdmissionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const queuedPrompt = "queued-after-idle-transition-runtime";
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "events",
		events: textResponseEvents("idle queued prompt completed"),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture, COMMAND_ADMISSION_HOST_OPTIONS);
		const sourcePath = readSessionFile(await process.request("idle-admission-source-state", "get_state"));

		const concurrentMark = process.mark();
		process.send({ id: "idle-admission-new-session", type: "new_session" });
		process.send({ id: "idle-admission-queued-prompt", type: "prompt", message: queuedPrompt });
		await process.waitFor(
			(frame) =>
				frame.type === "response" && frame.id === "idle-admission-new-session" && frame.command === "new_session",
			concurrentMark,
			5_000,
		);
		await process.waitFor(
			(frame) =>
				frame.type === "response" &&
				frame.id === "idle-admission-queued-prompt" &&
				frame.command === "prompt" &&
				frame.success === true,
			concurrentMark,
			5_000,
		);
		const terminal = await process.waitFor(
			(frame) =>
				frame.type === "agent_end" ||
				(frame.type === "response" &&
					frame.id === "idle-admission-queued-prompt" &&
					frame.command === "prompt" &&
					frame.success === false),
			concurrentMark,
			5_000,
		);
		const targetPath = readSessionFile(await process.request("idle-admission-target-state", "get_state"));

		return {
			outcome: terminal.type === "agent_end" ? "completed" : "failed",
			providerRequestCount: server.requests.length,
			queuedPromptReachedProvider: server.requests.some((request) => request.rawBody.includes(queuedPrompt)),
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			identityChanged: targetPath !== sourcePath,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runTransitionThenPrompt(): Promise<AdmissionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const queuedPrompt = "queued-after-transition-runtime";
	const server = await startOpenAiResponsesTestServer((_request, index) => {
		if (index === 0) return { kind: "hold", events: textResponseEvents("partial-before-admission").slice(0, 3) };
		return { kind: "events", events: textResponseEvents("queued prompt completed") };
	});
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture, COMMAND_ADMISSION_HOST_OPTIONS);
		const sourcePath = readSessionFile(await process.request("admission-source-state", "get_state"));

		const heldMark = process.mark();
		await process.request("admission-held-prompt", "prompt", { message: "Hold before admission transition" });
		await process.waitFor((frame) => frame.type === "message_update", heldMark);
		const concurrentMark = process.mark();
		process.send({ id: "admission-new-session", type: "new_session" });
		process.send({ id: "admission-queued-prompt", type: "prompt", message: queuedPrompt });
		await process.waitFor(
			(frame) =>
				frame.type === "response" && frame.id === "admission-new-session" && frame.command === "new_session",
			concurrentMark,
			5_000,
		);
		await process.waitFor(
			(frame) =>
				frame.type === "response" &&
				frame.id === "admission-queued-prompt" &&
				frame.command === "prompt" &&
				frame.success === true,
			concurrentMark,
			5_000,
		);
		await server.waitForHeldRequestClosed(5_000);
		const terminal = await process.waitFor(
			(frame) =>
				frame.type === "agent_end" ||
				(frame.type === "response" &&
					frame.id === "admission-queued-prompt" &&
					frame.command === "prompt" &&
					frame.success === false),
			concurrentMark,
			5_000,
		);
		const targetPath = readSessionFile(await process.request("admission-target-state", "get_state"));

		return {
			outcome: terminal.type === "agent_end" ? "completed" : "failed",
			providerRequestClosed: true,
			providerRequestCount: server.requests.length,
			queuedPromptReachedProvider: server.requests.some((request) => request.rawBody.includes(queuedPrompt)),
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			identityChanged: targetPath !== sourcePath,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runTransitionThenAbort(): Promise<AbortDuringTransitionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "hold",
		events: textResponseEvents("partial-before-transition-abort").slice(0, 3),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture, COMMAND_ADMISSION_HOST_OPTIONS);
		const sourcePath = readSessionFile(await process.request("abort-source-state", "get_state"));

		const heldMark = process.mark();
		await process.request("abort-held-prompt", "prompt", { message: "Hold before transition abort" });
		await process.waitFor((frame) => frame.type === "message_update", heldMark);
		const concurrentMark = process.mark();
		process.send({ id: "abort-new-session", type: "new_session" });
		process.send({ id: "abort-source-turn", type: "abort" });
		await process.waitFor(
			(frame) => frame.type === "response" && frame.id === "abort-new-session" && frame.command === "new_session",
			concurrentMark,
			5_000,
		);
		await process.waitFor(
			(frame) => frame.type === "response" && frame.id === "abort-source-turn" && frame.command === "abort",
			concurrentMark,
			5_000,
		);
		await server.waitForHeldRequestClosed(5_000);
		const targetPath = readSessionFile(await process.request("abort-target-state", "get_state"));

		return {
			providerRequestClosed: true,
			providerRequestCount: server.requests.length,
			terminalKinds: process
				.framesSince(heldMark)
				.flatMap((frame) => (frame.type === "agent_end" ? ["agent_end"] : [])),
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			identityChanged: targetPath !== sourcePath,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runTransitionThenClose(): Promise<TransitionShutdownObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "hold",
		events: textResponseEvents("partial-before-transition-close").slice(0, 3),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture, COMMAND_ADMISSION_HOST_OPTIONS);
		await process.request("close-source-state", "get_state");

		const heldMark = process.mark();
		await process.request("close-held-prompt", "prompt", { message: "Hold before transition close" });
		await process.waitFor((frame) => frame.type === "message_update", heldMark);
		process.send({ id: "close-new-session", type: "new_session" });
		const exitCode = await process.close();
		await server.waitForHeldRequestClosed(5_000);
		const conversationEntries = await readdir(fixture.conversationDir);

		return {
			exitCode,
			providerRequestClosed: true,
			providerRequestCount: server.requests.length,
			transitionResponseCount: process.frames.filter(
				(frame) => frame.type === "response" && frame.id === "close-new-session" && frame.command === "new_session",
			).length,
			ownershipLockCount: conversationEntries.filter(
				(name) => name.endsWith(".lock") || name.endsWith(".owner.lock"),
			).length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runExtensionShutdown(): Promise<ExtensionShutdownObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	try {
		fixture = await createAgentRpcFixture();
		const auditPath = `${fixture.root}/runtime-extension-shutdown.txt`;
		const extensionPath = `${fixture.root}/runtime-extension-shutdown.ts`;
		await writeFile(
			extensionPath,
			`import { appendFileSync } from "node:fs";
			export default function(extension) {
				extension.registerCommand("async-shutdown", {
					handler: async (_args, ctx) => {
						appendFileSync(${JSON.stringify(auditPath)}, "handler-before\\n", "utf8");
						await Promise.resolve();
						ctx.shutdown();
						appendFileSync(${JSON.stringify(auditPath)}, "handler-after\\n", "utf8");
					},
				});
				extension.on("session_shutdown", async () => {
					appendFileSync(${JSON.stringify(auditPath)}, "session-shutdown\\n", "utf8");
				});
			}`,
			"utf8",
		);
		process = startAgentRpc(executable, fixture, {
			...COMMAND_ADMISSION_HOST_OPTIONS,
			extraArgs: ["--extension", extensionPath],
		});
		await process.request("extension-shutdown-state", "get_state");

		const commandMark = process.mark();
		process.send({ id: "extension-shutdown-command", type: "prompt", message: "/async-shutdown" });
		const exitCode = await process.waitForExit();
		const conversationEntries = await readdir(fixture.conversationDir);
		const audit = (await readFile(auditPath, "utf8")).trim().split("\n");

		return {
			exitCode,
			promptResponseCount: process
				.framesSince(commandMark)
				.filter(
					(frame) =>
						frame.type === "response" && frame.id === "extension-shutdown-command" && frame.command === "prompt",
				).length,
			audit,
			ownershipLockCount: conversationEntries.filter(
				(name) => name.endsWith(".lock") || name.endsWith(".owner.lock"),
			).length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
	}
}

async function runHeldPromptThenClose(): Promise<PromptShutdownObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "hold",
		events: textResponseEvents("partial-before-prompt-close").slice(0, 3),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture, COMMAND_ADMISSION_HOST_OPTIONS);
		await process.request("prompt-close-state", "get_state");

		const mark = process.mark();
		await process.request("prompt-close-held", "prompt", { message: "Hold before prompt close" });
		await process.waitFor((frame) => frame.type === "message_update", mark);
		const exitCode = await process.close();
		await server.waitForHeldRequestClosed(5_000);
		const frames = process.framesSince(mark);

		return {
			exitCode,
			providerRequestClosed: true,
			providerRequestCount: server.requests.length,
			promptResponseCount: frames.filter(
				(frame) => frame.type === "response" && frame.id === "prompt-close-held" && frame.command === "prompt",
			).length,
			terminalOutcomeCount: countPromptTerminalOutcomes(frames, "prompt-close-held"),
			ownershipLockCount: await countOwnershipLocks(fixture),
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runHeldMemoryFlushThenClose(): Promise<MemoryFlushShutdownObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer((_request, index) =>
		index === 0 ? { kind: "events", events: textResponseEvents("Seed memory flush context") } : { kind: "hold" },
	);
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		const memoryFile = join(fixture.workspace, "MEMORY.md");
		await writeFile(memoryFile, "# Memory\n", "utf8");
		process = startAgentRpc(executable, fixture, {
			...COMMAND_ADMISSION_HOST_OPTIONS,
			extraArgs: ["--memory-mode", "--memory-file", memoryFile],
		});
		const seedMark = process.mark();
		await process.request("memory-close-seed", "prompt", { message: "Seed memory flush context" });
		await process.waitFor((frame) => frame.type === "agent_end", seedMark, 5_000);

		const flushMark = process.mark();
		process.send({ id: "memory-close-flush", type: "flush_memory" });
		await server.waitForHeldRequestStarted(5_000);
		const exitCode = await process.close();
		await server.waitForHeldRequestClosed(5_000);
		const frames = process.framesSince(flushMark);

		return {
			exitCode,
			providerRequestClosed: true,
			providerRequestCount: server.requests.length,
			flushResponseCount: frames.filter(
				(frame) =>
					frame.type === "response" &&
					frame.id === "memory-close-flush" &&
					frame.command === "flush_memory" &&
					frame.success === true,
			).length,
			ownershipLockCount: await countOwnershipLocks(fixture),
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runHostBridgeThenClose(): Promise<HostBridgeShutdownObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	let attachmentPath = "";
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "events",
		events: toolCallResponseEvents("im_send_attachment", {
			description: "Send before close",
			path: attachmentPath,
			kind: "file",
		}),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		attachmentPath = join(fixture.workspace, "bridge-close.txt");
		await writeFile(attachmentPath, "bridge close", "utf8");
		process = startAgentRpc(executable, fixture, COMMAND_ADMISSION_HOST_OPTIONS);
		await process.request("host-close-state", "get_state");

		const mark = process.mark();
		await process.request("host-close-prompt", "prompt", { message: "Send bridge-close.txt" });
		await process.waitFor((frame) => frame.type === "host_request", mark);
		const exitCode = await process.close();
		const frames = process.framesSince(mark);

		return {
			exitCode,
			providerRequestCount: server.requests.length,
			hostRequestCount: frames.filter((frame) => frame.type === "host_request").length,
			promptResponseCount: frames.filter(
				(frame) => frame.type === "response" && frame.id === "host-close-prompt" && frame.command === "prompt",
			).length,
			terminalOutcomeCount: countPromptTerminalOutcomes(frames, "host-close-prompt"),
			ownershipLockCount: await countOwnershipLocks(fixture),
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runExtensionUiThenClose(): Promise<ExtensionUiShutdownObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	try {
		fixture = await createAgentRpcFixture();
		const auditPath = join(fixture.root, "runtime-extension-ui-close.txt");
		const extensionPath = join(fixture.root, "runtime-extension-ui-close.ts");
		await writeFile(
			extensionPath,
			`import { appendFileSync } from "node:fs";
			export default function(extension) {
				extension.registerCommand("wait-for-ui-close", {
					handler: async (_args, ctx) => {
						appendFileSync(${JSON.stringify(auditPath)}, "before\\n", "utf8");
						const confirmed = await ctx.ui.confirm("Confirm", "Continue?");
						appendFileSync(${JSON.stringify(auditPath)}, \`after:\${confirmed}\\n\`, "utf8");
					},
				});
			}`,
			"utf8",
		);
		process = startAgentRpc(executable, fixture, {
			...COMMAND_ADMISSION_HOST_OPTIONS,
			extraArgs: ["--extension", extensionPath],
		});
		await process.request("extension-ui-close-state", "get_state");

		const mark = process.mark();
		await process.request("extension-ui-close-prompt", "prompt", { message: "/wait-for-ui-close" });
		await process.waitFor((frame) => frame.type === "extension_ui_request", mark);
		const exitCode = await process.close();
		const frames = process.framesSince(mark);

		return {
			exitCode,
			promptResponseCount: frames.filter(
				(frame) =>
					frame.type === "response" && frame.id === "extension-ui-close-prompt" && frame.command === "prompt",
			).length,
			extensionUiRequestCount: frames.filter((frame) => frame.type === "extension_ui_request").length,
			audit: (await readFile(auditPath, "utf8")).trim().split("\n"),
			ownershipLockCount: await countOwnershipLocks(fixture),
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
	}
}

function ownershipPath(sessionPath: string): string {
	return `${sessionPath}.owner.lock`;
}

function completedAdmissionObservation(): AdmissionObservation {
	return {
		outcome: "completed",
		providerRequestClosed: true,
		providerRequestCount: 2,
		queuedPromptReachedProvider: true,
		sourceOwnershipReleased: true,
		targetOwnershipHeld: true,
		identityChanged: true,
	};
}

function countPromptTerminalOutcomes(frames: readonly RpcFrame[], id: string): number {
	return frames.filter(
		(frame) =>
			frame.type === "agent_end" ||
			(frame.type === "response" && frame.id === id && frame.command === "prompt" && frame.success === false),
	).length;
}

async function countOwnershipLocks(fixture: AgentRpcFixture): Promise<number> {
	return (await readdir(fixture.conversationDir)).filter(
		(name) => name.endsWith(".lock") || name.endsWith(".owner.lock"),
	).length;
}
