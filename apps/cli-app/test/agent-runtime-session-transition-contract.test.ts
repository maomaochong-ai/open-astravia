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

describe("Agent Runtime active-turn session transition contract", () => {
	it("interrupts an active turn, changes ownership and recovers across new_session", async () => {
		const observation = await runActiveTurnNewSession();
		expect(observation).toEqual({
			providerRequestClosed: true,
			terminalKinds: [],
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			identityChanged: true,
			idleAfterTransition: true,
			providerRequestCount: 3,
		});
	}, 30_000);

	it("interrupts an active turn, transfers ownership and recovers across switch_session", async () => {
		const observation = await runActiveTurnSwitchSession();
		expect(observation).toEqual({
			providerRequestClosed: true,
			terminalKinds: [],
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			identityChanged: true,
			idleAfterTransition: true,
			providerRequestCount: 3,
		});
	}, 30_000);

	it("applies the same interruption and ownership contract to Extension session commands", async () => {
		const observation = await runActiveTurnExtensionNewSession();
		expect(observation).toEqual({
			providerRequestClosed: true,
			terminalKinds: [],
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			identityChanged: true,
			idleAfterTransition: true,
			providerRequestCount: 3,
		});
	}, 30_000);

	it("keeps the source identity usable when target ownership acquisition fails", async () => {
		const observation = await runLockedTargetSwitch();
		expect(observation).toEqual({
			transitionFailed: true,
			sourceIdentityRetained: true,
			sourceOwnershipHeld: true,
			targetOwnershipHeld: true,
			recoveryCompleted: true,
			providerRequestCount: 1,
		});
	}, 30_000);
});

interface TransitionObservation {
	readonly providerRequestClosed: boolean;
	readonly terminalKinds: readonly string[];
	readonly sourceOwnershipReleased: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly identityChanged: boolean;
	readonly idleAfterTransition: boolean;
	readonly providerRequestCount: number;
}

interface FailedTransitionObservation {
	readonly transitionFailed: boolean;
	readonly sourceIdentityRetained: boolean;
	readonly sourceOwnershipHeld: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly recoveryCompleted: boolean;
	readonly providerRequestCount: number;
}

async function runActiveTurnNewSession(): Promise<TransitionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer((_request, index) => {
		if (index === 0) return { kind: "hold", events: textResponseEvents("partial-before-new-session").slice(0, 3) };
		return {
			kind: "events",
			events: textResponseEvents(index === 1 ? "same-process-after-new-session" : "restart-after-new-session"),
		};
	});
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);
		const initialState = await process.request("transition-initial-state", "get_state");
		const sourcePath = readSessionFile(initialState);

		const turnMark = process.mark();
		await process.request("transition-held-prompt", "prompt", { message: "Hold active session turn" });
		await process.waitFor((frame) => frame.type === "message_update", turnMark);
		const transitionMark = process.mark();
		process.send({ id: "transition-new-session", type: "new_session" });
		await process.waitFor(
			(frame) =>
				frame.type === "response" && frame.id === "transition-new-session" && frame.command === "new_session",
			transitionMark,
			5_000,
		);
		await server.waitForHeldRequestClosed(5_000);
		const transitionedState = await process.request("transition-state-after-new", "get_state");
		const targetPath = readSessionFile(transitionedState);
		const terminalKinds = process
			.framesSince(turnMark)
			.flatMap((frame) => (frame.type === "agent_end" ? ["agent_end"] : []));

		const recoveryMark = process.mark();
		await process.request("transition-same-process-recovery", "prompt", { message: "Continue after new session" });
		await process.waitFor((frame) => frame.type === "agent_end", recoveryMark);
		await process.close();

		process = startAgentRpc(executable, fixture, { extraArgs: ["--session", targetPath] });
		const restartMark = process.mark();
		await process.request("transition-restart-recovery", "prompt", { message: "Continue after transition restart" });
		await process.waitFor((frame) => frame.type === "agent_end", restartMark);

		return {
			providerRequestClosed: true,
			terminalKinds,
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			identityChanged: targetPath !== sourcePath,
			idleAfterTransition: transitionedState.data?.isStreaming === false,
			providerRequestCount: server.requests.length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runActiveTurnSwitchSession(): Promise<TransitionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer((_request, index) => {
		if (index === 0) return { kind: "hold", events: textResponseEvents("partial-before-switch").slice(0, 3) };
		return {
			kind: "events",
			events: textResponseEvents(index === 1 ? "same-process-after-switch" : "restart-after-switch"),
		};
	});
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await process.request("switch-source-state", "get_state"));
		await process.request("switch-create-target", "new_session");
		const targetPath = readSessionFile(await process.request("switch-target-state", "get_state"));
		await process.request("switch-restore-source", "switch_session", { sessionPath: sourcePath });

		const turnMark = process.mark();
		await process.request("switch-held-prompt", "prompt", { message: "Hold turn before switch" });
		await process.waitFor((frame) => frame.type === "message_update", turnMark);
		const transitionMark = process.mark();
		process.send({ id: "switch-active-session", type: "switch_session", sessionPath: targetPath });
		await process.waitFor(
			(frame) =>
				frame.type === "response" && frame.id === "switch-active-session" && frame.command === "switch_session",
			transitionMark,
			5_000,
		);
		await server.waitForHeldRequestClosed(5_000);
		const transitionedState = await process.request("switch-state-after-transition", "get_state");
		const terminalKinds = process
			.framesSince(turnMark)
			.flatMap((frame) => (frame.type === "agent_end" ? ["agent_end"] : []));

		const recoveryMark = process.mark();
		await process.request("switch-same-process-recovery", "prompt", { message: "Continue after switch" });
		await process.waitFor((frame) => frame.type === "agent_end", recoveryMark);
		await process.close();

		process = startAgentRpc(executable, fixture, { extraArgs: ["--session", targetPath] });
		const restartMark = process.mark();
		await process.request("switch-restart-recovery", "prompt", { message: "Continue after switch restart" });
		await process.waitFor((frame) => frame.type === "agent_end", restartMark);

		return {
			providerRequestClosed: true,
			terminalKinds,
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			identityChanged: readSessionFile(transitionedState) === targetPath && targetPath !== sourcePath,
			idleAfterTransition: transitionedState.data?.isStreaming === false,
			providerRequestCount: server.requests.length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runActiveTurnExtensionNewSession(): Promise<TransitionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer((_request, index) => {
		if (index === 0) return { kind: "hold", events: textResponseEvents("partial-before-extension").slice(0, 3) };
		return {
			kind: "events",
			events: textResponseEvents(index === 1 ? "same-process-after-extension" : "restart-after-extension"),
		};
	});
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		const auditPath = join(fixture.root, "runtime-extension-transition.txt");
		const extensionPath = join(fixture.root, "runtime-session-transition-extension.ts");
		await writeFile(
			extensionPath,
			`import { appendFileSync } from "node:fs";
			export default function(extension) {
				extension.registerCommand("active-new-session", {
					handler: async (_args, ctx) => {
						appendFileSync(${JSON.stringify(auditPath)}, "started\\n", "utf8");
						const result = await ctx.newSession();
						appendFileSync(${JSON.stringify(auditPath)}, "done:" + result.cancelled + "\\n", "utf8");
					},
				});
			}`,
			"utf8",
		);
		process = startAgentRpc(executable, fixture, { extraArgs: ["--extension", extensionPath] });
		const sourcePath = readSessionFile(await process.request("extension-source-state", "get_state"));

		const turnMark = process.mark();
		await process.request("extension-held-prompt", "prompt", { message: "Hold turn before Extension command" });
		await process.waitFor((frame) => frame.type === "message_update", turnMark);
		await process.request("extension-transition-command", "prompt", { message: "/active-new-session" });
		await waitForFileText(auditPath, "done:false");
		await server.waitForHeldRequestClosed(5_000);
		const transitionedState = await process.request("extension-state-after-transition", "get_state");
		const targetPath = readSessionFile(transitionedState);
		const terminalKinds = process
			.framesSince(turnMark)
			.flatMap((frame) => (frame.type === "agent_end" ? ["agent_end"] : []));

		const recoveryMark = process.mark();
		await process.request("extension-same-process-recovery", "prompt", {
			message: "Continue after Extension transition",
		});
		await process.waitFor((frame) => frame.type === "agent_end", recoveryMark);
		await process.close();

		process = startAgentRpc(executable, fixture, { extraArgs: ["--session", targetPath] });
		const restartMark = process.mark();
		await process.request("extension-restart-recovery", "prompt", { message: "Continue after Extension restart" });
		await process.waitFor((frame) => frame.type === "agent_end", restartMark);

		return {
			providerRequestClosed: true,
			terminalKinds,
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			identityChanged: targetPath !== sourcePath,
			idleAfterTransition: transitionedState.data?.isStreaming === false,
			providerRequestCount: server.requests.length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runLockedTargetSwitch(): Promise<FailedTransitionObservation> {
	let fixture: AgentRpcFixture | undefined;
	let sourceProcess: AgentRpcProcess | undefined;
	let targetProcess: AgentRpcProcess | undefined;
	let stage = "create fixture";
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "events",
		events: textResponseEvents("source-recovered-after-failed-switch"),
	}));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		stage = "start source";
		sourceProcess = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await sourceProcess.request("locked-source-state", "get_state"));
		stage = "create target";
		await sourceProcess.request("locked-create-target", "new_session");
		const targetPath = readSessionFile(await sourceProcess.request("locked-target-state", "get_state"));
		stage = "restore source";
		await sourceProcess.request("locked-restore-source", "switch_session", { sessionPath: sourcePath });

		stage = "start target holder";
		targetProcess = startAgentRpc(executable, fixture, { extraArgs: ["--session", targetPath] });
		await targetProcess.request("locked-holder-state", "get_state");

		stage = "attempt locked switch";
		const transition = await sourceProcess.request("locked-switch", "switch_session", { sessionPath: targetPath });
		stage = "read source after failure";
		const stateAfterFailure = await sourceProcess.request("locked-state-after-failure", "get_state");
		const recoveryMark = sourceProcess.mark();
		stage = "recover source turn";
		await sourceProcess.request("locked-recovery-prompt", "prompt", {
			message: "Continue source after failed switch",
		});
		await sourceProcess.waitFor((frame) => frame.type === "agent_end", recoveryMark);

		return {
			transitionFailed: transition.type === "response" && transition.success === false,
			sourceIdentityRetained: readSessionFile(stateAfterFailure) === sourcePath,
			sourceOwnershipHeld: existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			recoveryCompleted: sourceProcess.framesSince(recoveryMark).some((frame) => frame.type === "agent_end"),
			providerRequestCount: server.requests.length,
		};
	} catch (error) {
		throw new Error(`Runtime locked-target stage failed: ${stage}`, { cause: error });
	} finally {
		await sourceProcess?.close();
		await targetProcess?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function waitForFileText(path: string, expected: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			if ((await readFile(path, "utf8")).includes(expected)) return;
		} catch (error) {
			if (!isMissingFileError(error)) throw error;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Timed out waiting for ${expected} in ${path}`);
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}

function ownershipPath(sessionPath: string): string {
	return `${sessionPath}.owner.lock`;
}
