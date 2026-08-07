import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	type AgentRpcExecutable,
	type AgentRpcFixture,
	type AgentRpcProcess,
	buildAgentRpcExecutable,
	createAgentRpcFixture,
	readSessionFile,
	readSessionId,
	startAgentRpc,
} from "./support/agent-rpc-test-process.js";
import {
	type OpenAiResponsesTestServer,
	startOpenAiResponsesTestServer,
	textResponseEvents,
} from "./support/openai-responses-test-server.js";

const RUNTIME_ID = "runtime";
const TREE_PREFIX = "EXTENSION_TREE_PREFIX";
const TREE_ABANDONED = "EXTENSION_TREE_ABANDONED";
const TREE_SUMMARY = "EXTENSION_TREE_SUMMARY";
const TREE_LABEL = "extension-tree-return";
const TREE_AFTER = "EXTENSION_TREE_AFTER";
const TREE_RESTART = "EXTENSION_TREE_RESTART";
const FORK_PREFIX = "EXTENSION_FORK_PREFIX";
const FORK_SELECTED = "EXTENSION_FORK_SELECTED";
const FORK_TAIL = "EXTENSION_FORK_TAIL";
const FORK_AFTER = "EXTENSION_FORK_AFTER";
const FORK_RESTART = "EXTENSION_FORK_RESTART";

let executable: AgentRpcExecutable;
const activeProcesses = new Set<AgentRpcProcess>();
const activeFixtures = new Set<AgentRpcFixture>();
const activeServers = new Set<OpenAiResponsesTestServer>();

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
}, 60_000);

afterAll(async () => {
	await executable.dispose();
});

afterEach(async () => {
	await Promise.allSettled([...activeProcesses].map((process) => process.close()));
	await Promise.allSettled([...activeFixtures].map((fixture) => fixture.dispose()));
	await Promise.allSettled([...activeServers].map((server) => server.dispose()));
	activeProcesses.clear();
	activeFixtures.clear();
	activeServers.clear();
});

describe("real RPC CLI Extension history command contract", () => {
	it("preserves tree cancellation, Extension summary, label, events and restart context", async () => {
		const observation = await runTreeScenario();
		expect(observation).toEqual({
			cancelKeptIdentity: true,
			events: [
				{ type: "session_before_tree", mode: "cancel" },
				{ type: "tree_result", mode: "cancel", cancelled: true },
				{ type: "session_before_tree", mode: "summary" },
				{ type: "session_tree", summary: TREE_SUMMARY, label: TREE_LABEL, fromExtension: true },
				{ type: "tree_result", mode: "summary", cancelled: false },
			],
			keptIdentity: true,
			providerAfter: { prefix: true, abandoned: false, summary: true },
			providerAfterRestart: { prefix: true, abandoned: false, summary: true, after: true },
		});
	}, 120_000);

	it("preserves fork cancellation, skipConversationRestore and persisted restart history", async () => {
		const observation = await runForkScenario();
		expect(observation).toEqual({
			cancelKeptIdentity: true,
			events: [
				{ type: "session_before_fork", mode: "cancel" },
				{ type: "fork_result", mode: "cancel", cancelled: true },
				{ type: "session_before_fork", mode: "preserve" },
				{ type: "session_fork" },
				{ type: "fork_result", mode: "preserve", cancelled: false },
			],
			forkChangedIdentity: true,
			providerAfter: { prefix: true, selected: true, tail: true },
			providerAfterRestart: { prefix: true, selected: false, tail: false, after: true },
			sourceUnchanged: true,
		});
	}, 120_000);
});

async function runTreeScenario() {
	const scenario = await createScenario();
	await promptTurn(scenario.process, `${RUNTIME_ID}-tree-prefix`, TREE_PREFIX);
	await promptTurn(scenario.process, `${RUNTIME_ID}-tree-abandoned`, TREE_ABANDONED);
	const before = await request(scenario.process, `${RUNTIME_ID}-tree-state-before`, "get_state");

	await request(scenario.process, `${RUNTIME_ID}-tree-cancel`, "prompt", { message: "/history-tree cancel" });
	await waitForObservationCount(scenario.observationPath, 2);
	await waitForObservationCount(scenario.commandCompletionPath, 1);
	const afterCancel = await request(scenario.process, `${RUNTIME_ID}-tree-state-cancel`, "get_state");
	await request(scenario.process, `${RUNTIME_ID}-tree-summary`, "prompt", { message: "/history-tree summary" });
	await waitForObservationCount(scenario.observationPath, 5);
	await waitForObservationCount(scenario.commandCompletionPath, 2);
	const afterSummary = await request(scenario.process, `${RUNTIME_ID}-tree-state-summary`, "get_state");

	try {
		await promptTurn(scenario.process, `${RUNTIME_ID}-tree-after`, TREE_AFTER);
	} catch (error) {
		const state = await request(scenario.process, `${RUNTIME_ID}-tree-failed-state`, "get_state");
		const sessionTail = (await readFile(readSessionFile(state), "utf8"))
			.trim()
			.split(/\r?\n/u)
			.slice(-8)
			.map((line) => {
				const value = JSON.parse(line) as {
					readonly command?: { readonly type?: string };
					readonly event?: { readonly error?: unknown; readonly type?: string };
					readonly recordType?: string;
				};
				return {
					command: value.command?.type,
					error: value.event?.error,
					event: value.event?.type,
					recordType: value.recordType,
				};
			});
		throw new Error(`Tree follow-up failed: state=${JSON.stringify(state)} tail=${JSON.stringify(sessionTail)}`, {
			cause: error,
		});
	}
	const providerAfter = scenario.server.requests.at(-1)?.rawBody ?? "";
	const sessionFile = readSessionFile(afterSummary);
	await closeProcess(scenario.process);
	scenario.process = startTrackedProcess(
		startAgentRpc(executable, scenario.fixture, {
			extraArgs: ["--extension", scenario.extensionPath, "--session", sessionFile],
		}),
	);
	await promptTurn(scenario.process, `${RUNTIME_ID}-tree-restart`, TREE_RESTART);
	const providerAfterRestart = scenario.server.requests.at(-1)?.rawBody ?? "";

	return {
		cancelKeptIdentity:
			readSessionId(afterCancel) === readSessionId(before) &&
			readSessionFile(afterCancel) === readSessionFile(before),
		events: await readObservations(scenario.observationPath),
		keptIdentity:
			readSessionId(afterSummary) === readSessionId(before) &&
			readSessionFile(afterSummary) === readSessionFile(before),
		providerAfter: historyPresence(providerAfter, {
			prefix: TREE_PREFIX,
			abandoned: TREE_ABANDONED,
			summary: TREE_SUMMARY,
		}),
		providerAfterRestart: historyPresence(providerAfterRestart, {
			prefix: TREE_PREFIX,
			abandoned: TREE_ABANDONED,
			summary: TREE_SUMMARY,
			after: TREE_AFTER,
		}),
	};
}

async function runForkScenario() {
	const scenario = await createScenario();
	await promptTurn(scenario.process, `${RUNTIME_ID}-fork-prefix`, FORK_PREFIX);
	await promptTurn(scenario.process, `${RUNTIME_ID}-fork-selected`, FORK_SELECTED);
	await promptTurn(scenario.process, `${RUNTIME_ID}-fork-tail`, FORK_TAIL);
	const before = await request(scenario.process, `${RUNTIME_ID}-fork-state-before`, "get_state");
	const sourceFile = readSessionFile(before);
	const sourceBefore = await readFile(sourceFile, "utf8");

	await request(scenario.process, `${RUNTIME_ID}-fork-cancel`, "prompt", { message: "/history-fork cancel" });
	await waitForObservationCount(scenario.observationPath, 2);
	await waitForObservationCount(scenario.commandCompletionPath, 1);
	const afterCancel = await request(scenario.process, `${RUNTIME_ID}-fork-state-cancel`, "get_state");
	await request(scenario.process, `${RUNTIME_ID}-fork-preserve`, "prompt", { message: "/history-fork preserve" });
	await waitForObservationCount(scenario.observationPath, 5);
	await waitForObservationCount(scenario.commandCompletionPath, 2);
	const afterFork = await request(scenario.process, `${RUNTIME_ID}-fork-state-success`, "get_state");

	await promptTurn(scenario.process, `${RUNTIME_ID}-fork-after`, FORK_AFTER);
	const providerAfter = scenario.server.requests.at(-1)?.rawBody ?? "";
	const forkFile = readSessionFile(afterFork);
	await closeProcess(scenario.process);
	scenario.process = startTrackedProcess(
		startAgentRpc(executable, scenario.fixture, {
			extraArgs: ["--extension", scenario.extensionPath, "--session", forkFile],
		}),
	);
	await promptTurn(scenario.process, `${RUNTIME_ID}-fork-restart`, FORK_RESTART);
	const providerAfterRestart = scenario.server.requests.at(-1)?.rawBody ?? "";

	return {
		cancelKeptIdentity:
			readSessionId(afterCancel) === readSessionId(before) &&
			readSessionFile(afterCancel) === readSessionFile(before),
		events: await readObservations(scenario.observationPath),
		forkChangedIdentity:
			readSessionId(afterFork) !== readSessionId(before) && readSessionFile(afterFork) !== readSessionFile(before),
		providerAfter: historyPresence(providerAfter, {
			prefix: FORK_PREFIX,
			selected: FORK_SELECTED,
			tail: FORK_TAIL,
		}),
		providerAfterRestart: historyPresence(providerAfterRestart, {
			prefix: FORK_PREFIX,
			selected: FORK_SELECTED,
			tail: FORK_TAIL,
			after: FORK_AFTER,
		}),
		sourceUnchanged: (await readFile(sourceFile, "utf8")) === sourceBefore,
	};
}

interface Scenario {
	readonly commandCompletionPath: string;
	readonly extensionPath: string;
	readonly fixture: AgentRpcFixture;
	readonly observationPath: string;
	readonly server: OpenAiResponsesTestServer;
	process: AgentRpcProcess;
}

async function createScenario(): Promise<Scenario> {
	const server = await startOpenAiResponsesTestServer((_request, index) => ({
		kind: "events",
		events: textResponseEvents(`Extension history response ${index}.`, { responseId: `extension_${index}` }),
	}));
	activeServers.add(server);
	const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl, contextWindow: 200_000, maxTokens: 4_000 });
	activeFixtures.add(fixture);
	const { commandCompletionPath, extensionPath, observationPath } = await writeHistoryExtension(fixture);
	const process = startTrackedProcess(
		startAgentRpc(executable, fixture, { extraArgs: ["--extension", extensionPath] }),
	);
	return { commandCompletionPath, extensionPath, fixture, observationPath, process, server };
}

function startTrackedProcess(process: AgentRpcProcess): AgentRpcProcess {
	activeProcesses.add(process);
	return process;
}

async function closeProcess(process: AgentRpcProcess): Promise<void> {
	await expect(process.close()).resolves.toBe(0);
	activeProcesses.delete(process);
}

async function promptTurn(process: AgentRpcProcess, id: string, message: string): Promise<void> {
	const mark = process.mark();
	await request(process, id, "prompt", { message });
	try {
		const terminal = await process.waitFor(
			(frame) =>
				frame.type === "agent_end" || (frame.type === "response" && frame.id === id && frame.success === false),
			mark,
			30_000,
		);
		if (terminal.type === "response") throw new Error(String(terminal.error));
	} catch (error) {
		throw new Error(`Failed while waiting for ${id} agent_end: ${JSON.stringify(process.framesSince(mark))}`, {
			cause: error,
		});
	}
}

async function request(
	process: AgentRpcProcess,
	id: string,
	type: string,
	data: Readonly<Record<string, unknown>> = {},
) {
	try {
		return await process.request(id, type, data);
	} catch (error) {
		throw new Error(`Failed RPC request ${id}`, { cause: error });
	}
}

function historyPresence(rawBody: string, markers: Readonly<Record<string, string>>): Record<string, boolean> {
	return Object.fromEntries(Object.entries(markers).map(([name, marker]) => [name, rawBody.includes(marker)]));
}

async function writeHistoryExtension(fixture: AgentRpcFixture) {
	const extensionDirectory = join(fixture.root, "extension-history");
	const extensionPath = join(extensionDirectory, "extension.ts");
	const observationPath = join(extensionDirectory, "observations.jsonl");
	const commandCompletionPath = join(extensionDirectory, "command-completions.jsonl");
	await mkdir(extensionDirectory, { recursive: true });
	await writeFile(
		extensionPath,
		`import { appendFileSync } from "node:fs";
		const observationPath = ${JSON.stringify(observationPath)};
		const commandCompletionPath = ${JSON.stringify(commandCompletionPath)};
		const treeTarget = ${JSON.stringify(TREE_ABANDONED)};
		const treeSummary = ${JSON.stringify(TREE_SUMMARY)};
		const treeLabel = ${JSON.stringify(TREE_LABEL)};
		const forkTarget = ${JSON.stringify(FORK_SELECTED)};
		let mode = "";
		function write(value) { appendFileSync(observationPath, JSON.stringify(value) + "\\n", "utf8"); }
		function commandCompleted() {
			setImmediate(() => appendFileSync(commandCompletionPath, "{}\\n", "utf8"));
		}
		function text(content) {
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return "";
			return content.filter((item) => item.type === "text").map((item) => item.text).join("\\n");
		}
		function findUser(ctx, marker) {
			const entry = ctx.sessionManager.getEntries().find((candidate) =>
				candidate.type === "message" && candidate.message.role === "user" && text(candidate.message.content).includes(marker));
			if (!entry) throw new Error("Missing user entry: " + marker);
			return entry;
		}
		export default function(extension) {
			extension.on("session_before_tree", async () => {
				write({ type: "session_before_tree", mode });
				if (mode === "cancel") return { cancel: true };
				return { summary: { summary: treeSummary, details: { source: "extension" } }, label: treeLabel };
			});
			extension.on("session_tree", async (event, ctx) => {
				write({
					type: "session_tree",
					summary: event.summaryEntry?.summary,
					label: event.summaryEntry ? ctx.sessionManager.getLabel(event.summaryEntry.id) : undefined,
					fromExtension: event.fromExtension === true,
				});
			});
			extension.on("session_before_fork", async () => {
				write({ type: "session_before_fork", mode });
				if (mode === "cancel") return { cancel: true };
				if (mode === "preserve") return { skipConversationRestore: true };
			});
			extension.on("session_fork", async () => { write({ type: "session_fork" }); });
			extension.registerCommand("history-tree", {
				async handler(args, ctx) {
					mode = args.trim();
					const result = await ctx.navigateTree(findUser(ctx, treeTarget).id, {
						summarize: mode === "summary",
						label: treeLabel,
					});
					write({ type: "tree_result", mode, cancelled: result.cancelled });
					commandCompleted();
				},
			});
			extension.registerCommand("history-fork", {
				async handler(args, ctx) {
					mode = args.trim();
					const result = await ctx.fork(findUser(ctx, forkTarget).id);
					write({ type: "fork_result", mode, cancelled: result.cancelled });
					commandCompleted();
				},
			});
		}`,
		"utf8",
	);
	return { commandCompletionPath, extensionPath, observationPath };
}

async function readObservations(path: string): Promise<readonly unknown[]> {
	const content = await readFile(path, "utf8");
	return content
		.trim()
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as unknown);
}

async function waitForObservationCount(path: string, count: number): Promise<void> {
	const deadline = Date.now() + 10_000;
	for (;;) {
		try {
			if ((await readObservations(path)).length >= count) return;
		} catch (error) {
			if (!isMissingFileError(error)) throw error;
		}
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${count} Extension observations`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}
