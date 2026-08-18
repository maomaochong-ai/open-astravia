import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
import {
	type ProviderRequestRecord,
	startOpenAiResponsesTestServer,
	textResponseEvents,
	toolCallResponseEvents,
} from "./support/openai-responses-test-server.js";

let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
});

afterAll(async () => {
	await executable.dispose();
});

describe("Agent Runtime session replacement resource contract", () => {
	it("replaces the resource domain across switch_session", async () => {
		const observation = await runSuccessfulSwitch();
		expect(observation).toEqual({
			backgroundStopped: true,
			pathChanged: true,
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			targetOwnershipReleased: true,
			targetTodoReset: true,
		});
	}, 40_000);

	it("retains the source resource domain when switch_session acquisition fails", async () => {
		const observation = await runFailedSwitch();
		expect(observation).toEqual({
			backgroundPreserved: false,
			backgroundStoppedOnClose: true,
			sourceIdentityRetained: true,
			sourceOwnershipHeld: true,
			sourceTodoRetained: true,
			targetOwnershipHeld: true,
			transitionFailed: true,
		});
	}, 40_000);

	it("creates a fresh resource domain across fork", async () => {
		const observation = await runSuccessfulFork();
		expect(observation).toEqual({
			backgroundStopped: true,
			pathChanged: true,
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			targetOwnershipReleased: true,
			targetTodoReset: true,
		});
	}, 40_000);
});

interface SuccessfulReplacementObservation {
	readonly backgroundStopped: boolean;
	readonly pathChanged: boolean;
	readonly sourceOwnershipReleased: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly targetOwnershipReleased: boolean;
	readonly targetTodoReset: boolean;
}

interface FailedReplacementObservation {
	readonly backgroundPreserved: boolean;
	readonly backgroundStoppedOnClose: boolean;
	readonly sourceIdentityRetained: boolean;
	readonly sourceOwnershipHeld: boolean;
	readonly sourceTodoRetained: boolean;
	readonly targetOwnershipHeld: boolean;
	readonly transitionFailed: boolean;
}

type ResourceSemantic = "fork" | "switch-failure" | "switch-success";

async function runSuccessfulSwitch(): Promise<SuccessfulReplacementObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const semantic = "switch-success";
	const server = await startOpenAiResponsesTestServer((request) => resourceResponse(request, semantic));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await process.request("switch-resource-source", "get_state"));
		await process.request("switch-resource-create-target", "new_session");
		const targetPath = readSessionFile(await process.request("switch-resource-target", "get_state"));
		await process.request("switch-resource-restore-source", "switch_session", { sessionPath: sourcePath });
		const pid = await seedResources(process, fixture, semantic);

		await expect(
			process.request("switch-resource-transition", "switch_session", { sessionPath: targetPath }),
		).resolves.toMatchObject({ success: true });
		const state = await process.request("switch-resource-state", "get_state");
		const targetOwnership = ownershipPath(targetPath);
		const targetTodoReset = await inspectTodo(process, server.requests, semantic, false);
		const observation = {
			backgroundStopped: await waitForProcessExit(pid),
			pathChanged: readSessionFile(state) === targetPath && targetPath !== sourcePath,
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(targetOwnership),
			targetTodoReset,
		};

		await process.close();
		return { ...observation, targetOwnershipReleased: !existsSync(targetOwnership) };
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runFailedSwitch(): Promise<FailedReplacementObservation> {
	let fixture: AgentRpcFixture | undefined;
	let sourceProcess: AgentRpcProcess | undefined;
	let targetProcess: AgentRpcProcess | undefined;
	const semantic = "switch-failure";
	const server = await startOpenAiResponsesTestServer((request) => resourceResponse(request, semantic));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		sourceProcess = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await sourceProcess.request("failed-resource-source", "get_state"));
		await sourceProcess.request("failed-resource-create-target", "new_session");
		const targetPath = readSessionFile(await sourceProcess.request("failed-resource-target", "get_state"));
		await sourceProcess.request("failed-resource-restore-source", "switch_session", { sessionPath: sourcePath });
		const pid = await seedResources(sourceProcess, fixture, semantic);

		targetProcess = startAgentRpc(executable, fixture, { extraArgs: ["--session", targetPath] });
		await targetProcess.request("failed-resource-holder", "get_state");
		const transition = await sourceProcess.request("failed-resource-transition", "switch_session", {
			sessionPath: targetPath,
		});
		const state = await sourceProcess.request("failed-resource-state", "get_state");
		const sourceTodoRetained = await inspectTodo(sourceProcess, server.requests, semantic, true);
		const observation = {
			backgroundPreserved: isProcessAlive(pid),
			sourceIdentityRetained: readSessionFile(state) === sourcePath,
			sourceOwnershipHeld: existsSync(ownershipPath(sourcePath)),
			sourceTodoRetained,
			targetOwnershipHeld: existsSync(ownershipPath(targetPath)),
			transitionFailed: transition.type === "response" && transition.success === false,
		};

		await sourceProcess.close();
		return { ...observation, backgroundStoppedOnClose: await waitForProcessExit(pid) };
	} finally {
		await sourceProcess?.close();
		await targetProcess?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function runSuccessfulFork(): Promise<SuccessfulReplacementObservation> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	const semantic = "fork";
	const server = await startOpenAiResponsesTestServer((request) => resourceResponse(request, semantic));
	try {
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture);
		const sourcePath = readSessionFile(await process.request("fork-resource-source", "get_state"));
		const pid = await seedResources(process, fixture, semantic);
		const messages = await process.request("fork-resource-messages", "get_fork_messages");
		const entryId = readForkEntryId(messages, `seed-${semantic}-resources`);

		await expect(process.request("fork-resource-transition", "fork", { entryId })).resolves.toMatchObject({
			success: true,
			data: { cancelled: false, text: `seed-${semantic}-resources` },
		});
		const state = await process.request("fork-resource-state", "get_state");
		const targetPath = readSessionFile(state);
		const targetOwnership = ownershipPath(targetPath);
		const targetTodoReset = await inspectTodo(process, server.requests, semantic, false);
		const observation = {
			backgroundStopped: await waitForProcessExit(pid),
			pathChanged: targetPath !== sourcePath,
			sourceOwnershipReleased: !existsSync(ownershipPath(sourcePath)),
			targetOwnershipHeld: existsSync(targetOwnership),
			targetTodoReset,
		};

		await process.close();
		return { ...observation, targetOwnershipReleased: !existsSync(targetOwnership) };
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server.dispose();
	}
}

async function seedResources(
	process: AgentRpcProcess,
	fixture: AgentRpcFixture,
	semantic: ResourceSemantic,
): Promise<number> {
	const mark = process.mark();
	await process.request(`${semantic}-seed`, "prompt", { message: `seed-${semantic}-resources` });
	await process.waitFor((frame) => frame.type === "agent_end", mark, 10_000);
	return waitForPid(join(fixture.workspace, `${semantic}-background.pid`));
}

async function inspectTodo(
	process: AgentRpcProcess,
	requests: readonly ProviderRequestRecord[],
	semantic: ResourceSemantic,
	expectedRetained: boolean,
): Promise<boolean> {
	const mark = process.mark();
	await process.request(`${semantic}-inspect`, "prompt", { message: `inspect-${semantic}-todos` });
	await process.waitFor((frame) => frame.type === "agent_end", mark, 10_000);
	const rawBody = requests.at(-1)?.rawBody ?? "";
	return (
		rawBody.includes("call_inspect_todo") &&
		rawBody.includes(expectedRetained ? "replacement todo" : "No todo items.")
	);
}

function resourceResponse(
	request: ProviderRequestRecord,
	semantic: ResourceSemantic,
): { readonly kind: "events"; readonly events: readonly unknown[] } {
	if (request.rawBody.includes(`inspect-${semantic}-todos`)) {
		return request.rawBody.includes("call_inspect_todo")
			? { kind: "events", events: textResponseEvents("Todo state inspected.") }
			: {
					kind: "events",
					events: toolCallResponseEvents(
						"todo",
						{ action: "list", description: "Inspect replacement todo state" },
						{ callId: "call_inspect_todo", itemId: "fc_inspect_todo" },
					),
				};
	}
	if (request.rawBody.includes(`seed-${semantic}-resources`)) {
		if (!request.rawBody.includes("call_seed_todo")) {
			return {
				kind: "events",
				events: toolCallResponseEvents(
					"todo",
					{ action: "create", description: "Seed replacement todo state", items: ["replacement todo"] },
					{ callId: "call_seed_todo", itemId: "fc_seed_todo" },
				),
			};
		}
		if (!request.rawBody.includes("call_seed_todo_done")) {
			return {
				kind: "events",
				events: toolCallResponseEvents(
					"todo",
					{ action: "update", description: "Complete replacement todo state", id: 1, status: "done" },
					{ callId: "call_seed_todo_done", itemId: "fc_seed_todo_done" },
				),
			};
		}
		if (!request.rawBody.includes("call_seed_shell")) {
			return {
				kind: "events",
				events: toolCallResponseEvents(
					process.platform === "win32" ? "shell" : "bash",
					{ command: heldProcessCommand(`${semantic}-background.pid`), run_in_background: true },
					{ callId: "call_seed_shell", itemId: "fc_seed_shell" },
				),
			};
		}
		return { kind: "events", events: textResponseEvents("Replacement resources seeded.") };
	}
	return { kind: "events", events: textResponseEvents(`Unexpected ${semantic} request.`) };
}

function readForkEntryId(response: unknown, text: string): string {
	if (!isRecord(response)) throw new Error("Expected fork message response");
	const data = response.data;
	if (!isRecord(data) || !Array.isArray(data.messages)) {
		throw new Error(`Expected fork messages: ${JSON.stringify(response)}`);
	}
	for (const message of data.messages) {
		if (isRecord(message) && message.text === text && typeof message.entryId === "string") {
			return message.entryId;
		}
	}
	throw new Error(`Fork message was not found: ${text}`);
}

function heldProcessCommand(relativePidPath: string): string {
	if (process.platform === "win32") {
		return `$PID | Set-Content -LiteralPath '${relativePidPath}' -Encoding ascii; Start-Sleep -Seconds 60`;
	}
	return `printf '%s' "$$" > '${relativePidPath}'; sleep 60`;
}

async function waitForPid(path: string): Promise<number> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
			if (Number.isSafeInteger(pid) && pid > 0) return pid;
		} catch {
			// The command has not written its PID yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for background PID file: ${path}`);
}

async function waitForProcessExit(pid: number): Promise<boolean> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (!isProcessAlive(pid)) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return !isProcessAlive(pid);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function ownershipPath(sessionPath: string): string {
	return `${sessionPath}.owner.lock`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
