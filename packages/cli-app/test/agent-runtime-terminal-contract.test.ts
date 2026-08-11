import { writeFile } from "node:fs/promises";
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
import { legacyRuntimeContract } from "./support/legacy-runtime-contract.js";
import { startOpenAiResponsesTestServer, textResponseEvents } from "./support/openai-responses-test-server.js";

let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
});

afterAll(async () => {
	await executable.dispose();
});

describe("Agent Runtime terminal contract", () => {
	it("emits one terminal outcome and recovers after a Provider HTTP failure", async () => {
		const observation = await runHttpFailureRecovery();
		expect(observation).toEqual({
			failureTerminalKinds: legacyRuntimeContract.rpc.terminalFailureKinds,
			idleAfterFailure: true,
			providerRequestCount: 3,
		});
	}, 30_000);

	it("emits one terminal outcome and recovers after a Provider stream disconnect", async () => {
		const observation = await runStreamDisconnectRecovery();
		expect(observation).toEqual({
			failureTerminalKinds: legacyRuntimeContract.rpc.terminalFailureKinds,
			idleAfterFailure: true,
			partialText: "partial-before-disconnect",
			providerRequestCount: 2,
		});
	}, 30_000);

	it("returns to idle and recovers in-process and after restart following abort", async () => {
		const observation = await runAbortRecovery();
		expect(observation).toEqual({
			failureTerminalKinds: legacyRuntimeContract.rpc.terminalFailureKinds,
			idleAfterFailure: true,
			providerRequestCount: 3,
		});
	}, 30_000);
});

interface TerminalRecoveryObservation {
	readonly failureTerminalKinds: readonly string[];
	readonly idleAfterFailure: boolean;
	readonly providerRequestCount: number;
}

interface StreamRecoveryObservation extends TerminalRecoveryObservation {
	readonly partialText: string;
}

async function runHttpFailureRecovery(): Promise<TerminalRecoveryObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer((_request, index) => {
		if (index === 0) {
			return { kind: "http-error", status: 400, body: "intentional Provider HTTP failure" };
		}
		return {
			kind: "events",
			events: textResponseEvents(index === 1 ? "same-process-recovered" : "restart-recovered"),
		};
	});
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);

		const failureMark = process.mark();
		await process.request("prompt-provider-failure", "prompt", { message: "Trigger Provider failure" });
		await process.waitFor((frame) => frame.type === "agent_end", failureMark);
		const failedState = await process.request("state-after-provider-failure", "get_state");
		const failureTerminalKinds = readTerminalKinds(process, failureMark);

		const recoveryMark = process.mark();
		await process.request("prompt-same-process-recovery", "prompt", { message: "Recover in the same process" });
		await process.waitFor((frame) => frame.type === "agent_end", recoveryMark);
		const resumedSessionPath = readSessionFile(await process.request("state-before-restart", "get_state"));
		await process.close();

		process = startAgentRpc(executable, fixture, { extraArgs: ["--session", resumedSessionPath] });
		const restartMark = process.mark();
		await process.request("prompt-restart-recovery", "prompt", { message: "Recover after restart" });
		await process.waitFor((frame) => frame.type === "agent_end", restartMark);

		return {
			failureTerminalKinds,
			idleAfterFailure: failedState.data?.isStreaming === false,
			providerRequestCount: server.requests.length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runStreamDisconnectRecovery(): Promise<StreamRecoveryObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer((_request, index) => {
		if (index === 0) {
			return {
				kind: "disconnect",
				events: textResponseEvents("partial-before-disconnect").slice(0, 3),
				delayMs: 20,
			};
		}
		return { kind: "events", events: textResponseEvents("stream-disconnect-recovered") };
	});
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		await writeFile(join(fixture.agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }), "utf8");
		process = startAgentRpc(executable, fixture);

		const failureMark = process.mark();
		await process.request("prompt-stream-disconnect", "prompt", { message: "Trigger stream disconnect" });
		await process.waitFor((frame) => frame.type === "agent_end", failureMark);
		const failedState = await process.request("state-after-stream-disconnect", "get_state");
		const failureTerminalKinds = readTerminalKinds(process, failureMark);
		const partialText = process
			.framesSince(failureMark)
			.flatMap((frame) => {
				if (frame.type !== "message_update") return [];
				const event = frame.assistantMessageEvent;
				if (typeof event !== "object" || event === null || Reflect.get(event, "type") !== "text_delta") return [];
				const delta = Reflect.get(event, "delta");
				return typeof delta === "string" ? [delta] : [];
			})
			.join("");

		const recoveryMark = process.mark();
		await process.request("prompt-stream-recovery", "prompt", { message: "Recover from stream disconnect" });
		await process.waitFor((frame) => frame.type === "agent_end", recoveryMark);

		return {
			failureTerminalKinds,
			idleAfterFailure: failedState.data?.isStreaming === false,
			partialText,
			providerRequestCount: server.requests.length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runAbortRecovery(): Promise<TerminalRecoveryObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const server = await startOpenAiResponsesTestServer((_request, index) => {
		if (index === 0) {
			return { kind: "hold", events: textResponseEvents("partial-before-abort").slice(0, 3) };
		}
		return {
			kind: "events",
			events: textResponseEvents(index === 1 ? "same-process-after-abort" : "restart-after-abort"),
		};
	});
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);

		const abortMark = process.mark();
		await process.request("prompt-before-abort", "prompt", { message: "Stream until aborted" });
		await process.waitFor((frame) => frame.type === "message_update", abortMark);
		await expect(process.request("abort-active-turn", "abort")).resolves.toMatchObject({ success: true });
		await process.waitFor((frame) => frame.type === "agent_end", abortMark);
		await server.waitForHeldRequestClosed();
		const abortedState = await process.request("state-after-abort", "get_state");
		const failureTerminalKinds = readTerminalKinds(process, abortMark);

		const recoveryMark = process.mark();
		await process.request("prompt-after-abort", "prompt", { message: "Recover after abort" });
		await process.waitFor((frame) => frame.type === "agent_end", recoveryMark);
		const resumedSessionPath = readSessionFile(await process.request("state-before-abort-restart", "get_state"));
		await process.close();

		process = startAgentRpc(executable, fixture, { extraArgs: ["--session", resumedSessionPath] });
		const restartMark = process.mark();
		await process.request("prompt-after-abort-restart", "prompt", { message: "Recover after abort restart" });
		await process.waitFor((frame) => frame.type === "agent_end", restartMark);

		return {
			failureTerminalKinds,
			idleAfterFailure: abortedState.data?.isStreaming === false,
			providerRequestCount: server.requests.length,
		};
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

function readTerminalKinds(process: AgentRpcProcess, afterIndex: number): readonly string[] {
	return process.framesSince(afterIndex).flatMap((frame) => {
		if (frame.type === "agent_end") return ["agent_end"];
		if (frame.type === "response" && frame.command === "prompt" && frame.success === false) return ["prompt_error"];
		return [];
	});
}
