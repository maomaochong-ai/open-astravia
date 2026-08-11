import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionRpcRuntime } from "@vetta/action-rpc";
import { ACTION_RPC_ENDPOINT_FILE_ENV } from "@vetta/action-rpc";
import type { Api, Model } from "@vetta/ai";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import { CatalogRoutedRuntimeSessionAccessResolver, RuntimeHost } from "@vetta/runtime-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	type OpenAiResponsesTestServer,
	startOpenAiResponsesTestServer,
	textResponseEvents,
} from "../../../../../cli-app/test/support/openai-responses-test-server.js";
import { DesktopRuntimeBackendPool } from "../../agent-runtime/backend-pool.js";
import { DesktopRuntimeSessionCatalog } from "../../agent-runtime/session-catalog.js";
import { DesktopConversationService } from "../../conversations/desktop-conversation-service.js";
import { type DesktopLocalRpcServerHandle, startDesktopLocalRpcServer } from "../../local-rpc/server.js";
import { AppDebugCatalog } from "../catalog.js";
import { createDebugRpcRuntime } from "../rpc.js";
import { AppDebugRuntime } from "../runtime.js";
import { createConversationDebugDefinitions } from "./definitions.js";

vi.mock("../../logger.js", () => ({
	getAppLogger: () => ({
		debug: () => undefined,
		error: () => undefined,
		info: () => undefined,
		warn: () => undefined,
	}),
}));

vi.mock("../../app-monitor/app-monitor-service.js", () => ({
	monitorRuntimeSession: () => undefined,
}));

vi.mock("../../ipc/fs.js", () => ({
	allowProjectRoot: () => undefined,
	DEFAULT_CONVERSATION_CWD: "C:/vetta/conversation",
	DEFAULT_CONVERSATION_SESSION_DIR: "C:/vetta/conversation/.vetta/sessions",
	DEFAULT_IM_CONVERSATION_CWD: "C:/vetta/im",
	DEFAULT_IM_CONVERSATION_SESSION_DIR: "C:/vetta/im/.vetta/sessions",
	KB_PROCESSING_CWD: "C:/vetta/knowledge",
	KB_PROCESSING_SESSION_DIR: "C:/vetta/knowledge/.vetta/sessions",
	readDesktopConfig: async () => ({
		agentMode: "work",
		defaultExecutionMode: "full-access",
		experimental: { agentSkills: false },
	}),
}));

vi.mock("../../plugins/plugin-store.js", () => ({
	buildAgentPluginRuntimeConfig: () => undefined,
	setPluginRuntimeAgentMode: () => undefined,
	summarizeAgentPluginRuntimeConfig: () => ({}),
}));

vi.mock("../../runtime.js", () => ({
	getSharedRuntime: () => {
		throw new Error("Unexpected shared runtime access in CLI canary");
	},
}));

vi.mock("../../sandbox/capability.js", () => ({
	assertSandboxAvailableForMode: async () => undefined,
}));

const cliPath = fileURLToPath(new URL("../../../../../cli-app/src/cli.ts", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../../../..", import.meta.url));
const firstPrompt = "Reply with exactly DESKTOP_CLI_CANARY_FIRST.";
const secondPrompt = "Reply with exactly DESKTOP_CLI_CANARY_SECOND.";
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

const completedOperationSchema = z
	.object({
		operationId: z.string().uuid(),
		sessionId: z.string().min(1),
		sessionPath: z.string().min(1),
		cwd: z.string().min(1),
		status: z.literal("completed"),
		stopReason: z.string().min(1),
		assistantText: z.string(),
		messageCount: z.number().int().nonnegative(),
	})
	.strict();

const completedCliResponseSchema = z
	.object({
		ok: z.literal(true),
		result: completedOperationSchema,
	})
	.strict();

const sessionSummarySchema = z
	.object({
		id: z.string().min(1),
		sessionPath: z.string().min(1),
		cwd: z.string().min(1),
	})
	.passthrough();

const listCliResponseSchema = z
	.object({
		ok: z.literal(true),
		result: z.array(sessionSummarySchema),
	})
	.strict();

interface CliResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

describe("Vetta CLI Desktop Runtime canary", { timeout: INTEGRATION_TEST_TIMEOUT_MS }, () => {
	const directories: string[] = [];
	let provider: OpenAiResponsesTestServer | undefined;
	let runtime: RuntimeHost | undefined;
	let pool: DesktopRuntimeBackendPool | undefined;
	let rpcServer: DesktopLocalRpcServerHandle | undefined;

	afterEach(async () => {
		await rpcServer?.close();
		rpcServer = undefined;
		await runtime?.disposeAllSessions();
		runtime = undefined;
		await pool?.dispose();
		pool = undefined;
		await provider?.dispose();
		provider = undefined;
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	}, INTEGRATION_TEST_TIMEOUT_MS);

	it("creates, continues and lists a persistent conversation through the existing CLI", async () => {
		const root = await temporaryDirectory("vetta-desktop-cli-canary-");
		const workspace = join(root, "workspace");
		const endpointFilePath = join(root, "action-server.json");
		await mkdir(workspace);

		provider = await startOpenAiResponsesTestServer(({ body }) => {
			const input = JSON.stringify(body.input);
			if (input.includes("DESKTOP_CLI_CANARY_SECOND")) {
				return { kind: "events", events: textResponseEvents("DESKTOP_CLI_CANARY_SECOND") };
			}
			if (input.includes("DESKTOP_CLI_CANARY_FIRST")) {
				return { kind: "events", events: textResponseEvents("DESKTOP_CLI_CANARY_FIRST") };
			}
			return { kind: "events", events: textResponseEvents("Desktop CLI Canary") };
		});

		const model: Model<Api> = {
			...canaryModel,
			baseUrl: provider.baseUrl,
		};
		pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(model),
				initialModel: model,
				initialThinkingLevel: "off",
			},
		});
		const sessionCatalog = new DesktopRuntimeSessionCatalog({
			resolveRoots: () => [{ cwd: workspace, sessionDir: join(workspace, ".vetta", "sessions") }],
		});
		runtime = new RuntimeHost({
			sessionBackend: pool,
			sessionCatalog,
			sessionAccessResolver: new CatalogRoutedRuntimeSessionAccessResolver([
				{
					catalog: sessionCatalog,
					access: {
						readHistory: true,
						interactiveResume: true,
						rename: true,
						delete: true,
					},
				},
			]),
			getDefaultExecutionMode: () => "full-access",
		});

		const catalog = new AppDebugCatalog();
		const service = new DesktopConversationService(runtime);
		for (const definition of createConversationDebugDefinitions(service)) catalog.register(definition);
		rpcServer = await startDesktopLocalRpcServer(
			{
				actions: emptyActionRuntime,
				debug: createDebugRpcRuntime(new AppDebugRuntime(catalog)),
			},
			{ endpointFilePath },
		);
		expect(existsSync(endpointFilePath)).toBe(true);

		const createResponse = completedCliResponseSchema.parse(
			await runVettaDebug(endpointFilePath, "conversation.create", {
				cwd: workspace,
				prompt: firstPrompt,
				executionMode: "full-access",
				modelKey: `${model.provider}/${model.id}`,
				timeoutMs: 30_000,
			}),
		);
		expect(createResponse.result).toMatchObject({
			cwd: workspace,
			assistantText: "DESKTOP_CLI_CANARY_FIRST",
			messageCount: 2,
		});
		expect(existsSync(createResponse.result.sessionPath)).toBe(true);

		const continueResponse = completedCliResponseSchema.parse(
			await runVettaDebug(endpointFilePath, "conversation.continue", {
				sessionPath: createResponse.result.sessionPath,
				prompt: secondPrompt,
				executionMode: "full-access",
				modelKey: `${model.provider}/${model.id}`,
				timeoutMs: 30_000,
			}),
		);
		expect(continueResponse.result).toMatchObject({
			sessionPath: createResponse.result.sessionPath,
			cwd: workspace,
			assistantText: "DESKTOP_CLI_CANARY_SECOND",
			messageCount: 4,
		});

		const listResponse = listCliResponseSchema.parse(
			await runVettaDebug(endpointFilePath, "conversation.list", { cwd: workspace, limit: 20 }),
		);
		expect(listResponse.result).toContainEqual(
			expect.objectContaining({
				sessionPath: createResponse.result.sessionPath,
				cwd: workspace,
			}),
		);
		expect(provider.requests.some(({ rawBody }) => rawBody.includes("DESKTOP_CLI_CANARY_FIRST"))).toBe(true);
		expect(provider.requests.some(({ rawBody }) => rawBody.includes("DESKTOP_CLI_CANARY_SECOND"))).toBe(true);

		await runtime.disposeAllSessions();
		expect(() => runtime?.getState(createResponse.result.sessionId)).toThrow("Session not found");
		runtime = undefined;
		await pool.dispose();
		expect(pool.readScopeCount()).toBe(0);
		pool = undefined;
		await rpcServer.close();
		rpcServer = undefined;
		expect(existsSync(endpointFilePath)).toBe(false);
	});

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

async function runVettaDebug(endpointFilePath: string, debugId: string, input: unknown): Promise<unknown> {
	const result = await runCli(["debug", "run", debugId, JSON.stringify(input)], {
		...process.env,
		[ACTION_RPC_ENDPOINT_FILE_ENV]: endpointFilePath,
	});
	if (result.code !== 0) {
		throw new Error(
			`Vetta CLI failed with code ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
	return JSON.parse(result.stdout) as unknown;
}

async function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
	return await new Promise<CliResult>((resolve, reject) => {
		const child = spawn("bun", [cliPath, ...args], {
			cwd: repositoryRoot,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (signal) {
				reject(new Error(`Vetta CLI exited with signal ${signal}\nstderr:\n${stderr}`));
				return;
			}
			resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
		});
	});
}

function modelRegistry(model: Model<Api>): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [model],
		find: (provider, modelId) => (provider === model.provider && modelId === model.id ? model : undefined),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

const emptyActionRuntime: ActionRpcRuntime = {
	search: () => [],
	describe: () => ({}),
	run: () => ({}),
};

const canaryModel: Model<Api> = {
	id: "desktop-cli-canary-model",
	name: "Desktop CLI Canary Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
