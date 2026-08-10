import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";
import type { EcosystemHookAdapterFactory } from "@vetta/coding-agent/hooks";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import { RuntimeHost } from "@vetta/runtime-core";
import type { McpRuntimeToolSource } from "@vetta/runtime-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopRuntimeBackendPool } from "./backend-pool.js";
import { DesktopRuntimeSessionCatalog } from "./session-catalog.js";

describe("DesktopRuntimeBackendPool", () => {
	const directories: string[] = [];
	const runtimes: RuntimeHost[] = [];
	const pools: DesktopRuntimeBackendPool[] = [];

	afterEach(async () => {
		for (const runtime of runtimes.splice(0).reverse()) await runtime.disposeAllSessions();
		for (const pool of pools.splice(0).reverse()) await pool.dispose();
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("reuses one scoped composition and isolates different workspaces", async () => {
		const firstCwd = await temporaryDirectory("desktop-runtime-pool-first-");
		const secondCwd = await temporaryDirectory("desktop-runtime-pool-second-");
		const pool = createPool();
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(pool);
		runtimes.push(runtime);

		const first = await runtime.createSession({
			cwd: firstCwd,
			model: MODEL,
			scenario: "batch",
		});
		const sameScope = await runtime.createSession({
			cwd: firstCwd,
			model: MODEL,
			scenario: "batch",
		});
		const second = await runtime.createSession({
			cwd: secondCwd,
			model: MODEL,
			scenario: "automation",
		});

		expect(pool.readScopeCount()).toBe(2);
		expect(pool.readSession(first.sessionId)).toBeDefined();
		expect(pool.readSession(sameScope.sessionId)).toBeDefined();
		expect(pool.readSession(second.sessionId)).toBeDefined();
		expect(runtime.getState(first.sessionId).scenario).toBe("batch");
		expect(runtime.getState(second.sessionId).scenario).toBe("automation");
	});

	it("uses cwd/.vetta/sessions for project listing when sessionDir is omitted", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-catalog-root-");
		const pool = createPool();
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(pool);
		runtimes.push(runtime);

		const created = await runtime.createSession({
			cwd,
			model: MODEL,
			scenario: "batch",
		});
		const catalog = new DesktopRuntimeSessionCatalog({
			resolveRoots: () => [{ cwd, sessionDir: join(cwd, ".vetta", "sessions") }],
		});
		const sessions = await catalog.listSessions(cwd);

		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			id: created.sessionId,
			cwd,
		});
	});

	it("deduplicates concurrent host ownership and resumes after the backend pool is recreated", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-restart-");
		const initialPool = createPool();
		const initialRuntime = new RuntimeHost({
			sessionBackend: initialPool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(initialPool);
		runtimes.push(initialRuntime);

		const created = await initialRuntime.createSession({
			cwd,
			model: MODEL,
			scenario: "batch",
		});
		const sessionPath = initialRuntime.getSessionPath(created.sessionId);
		if (!sessionPath) throw new Error("Runtime pool did not expose a session path");
		const duplicateOpen = await initialRuntime.createSession({
			cwd,
			sessionPath,
			model: MODEL,
			scenario: "batch",
		});

		expect(duplicateOpen.sessionId).toBe(created.sessionId);
		expect(initialPool.readScopeCount()).toBe(1);

		await initialRuntime.disposeAllSessions();
		await initialPool.dispose();
		const resumedPool = createPool();
		const resumedRuntime = new RuntimeHost({
			sessionBackend: resumedPool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(resumedPool);
		runtimes.push(resumedRuntime);
		const resumed = await resumedRuntime.createSession({
			cwd,
			sessionPath,
			model: MODEL,
			scenario: "batch",
		});

		expect(resumed.sessionId).toBe(created.sessionId);
		expect(resumedRuntime.getSessionPath(resumed.sessionId)).toBe(sessionPath);
		expect(resumedPool.readScopeCount()).toBe(1);
	});

	it("does not accept new sessions after the process-level pool is disposed", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-disposed-pool-");
		const pool = createPool();
		pools.push(pool);
		await pool.dispose();

		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		runtimes.push(runtime);
		await expect(runtime.createSession({ cwd, model: MODEL, scenario: "batch" })).rejects.toThrow("disposed");
	});

	it("injects and disposes one managed MCP source per workspace scope", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-mcp-source-");
		const source = {
			refresh: async () => ({ tools: [] }),
		} satisfies McpRuntimeToolSource;
		const dispose = vi.fn(async () => undefined);
		const createMcpRuntimeSource = vi.fn(async () => ({ source, dispose }));
		let capturedSource: McpRuntimeToolSource | undefined;
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
			},
			createMcpRuntimeSource,
			createComposition: async (options) => {
				capturedSource = options.mcpSource;
				return await createCodingAgentRuntimeComposition(options);
			},
		});
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(pool);
		runtimes.push(runtime);

		await runtime.createSession({ cwd, model: MODEL, scenario: "batch" });
		await runtime.createSession({ cwd, model: MODEL, scenario: "batch" });

		expect(createMcpRuntimeSource).toHaveBeenCalledTimes(1);
		expect(createMcpRuntimeSource).toHaveBeenCalledWith({ cwd, agentDir: undefined });
		expect(capturedSource).toBe(source);
		await runtime.disposeAllSessions();
		await pool.dispose();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("combines host and scope-specific Hook adapter factories for each composition", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-hook-adapter-");
		const hostFactory: EcosystemHookAdapterFactory = async () => undefined;
		const scopedFactory: EcosystemHookAdapterFactory = async () => undefined;
		const createHookAdapterFactories = vi.fn(() => [scopedFactory]);
		let capturedFactories: readonly EcosystemHookAdapterFactory[] | undefined;
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				additionalHookAdapterFactories: [hostFactory],
			},
			createHookAdapterFactories,
			createComposition: async (options) => {
				capturedFactories = options.additionalHookAdapterFactories;
				return await createCodingAgentRuntimeComposition(options);
			},
		});
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(pool);
		runtimes.push(runtime);

		await runtime.createSession({ cwd, model: MODEL, scenario: "batch" });

		expect(createHookAdapterFactories).toHaveBeenCalledWith(
			expect.objectContaining({ cwd, agentDir: undefined, scenario: "batch" }),
		);
		expect(capturedFactories).toEqual([hostFactory, scopedFactory]);
	});

	it("reuses one MCP source across isolated runtime scopes with the same MCP scope", async () => {
		const rootCwd = await temporaryDirectory("desktop-runtime-mcp-root-");
		const firstCwd = join(rootCwd, "first-session");
		const secondCwd = join(rootCwd, "second-session");
		const source = {
			refresh: async () => ({ tools: [] }),
		} satisfies McpRuntimeToolSource;
		const dispose = vi.fn(async () => undefined);
		const createMcpRuntimeSource = vi.fn(async () => ({ source, dispose }));
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
			},
			createMcpRuntimeSource,
			resolveMcpRuntimeScope: ({ agentDir }) => ({ cwd: rootCwd, agentDir }),
		});
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(pool);
		runtimes.push(runtime);

		await runtime.createSession({ cwd: firstCwd, model: MODEL, scenario: "conversation" });
		await runtime.createSession({ cwd: secondCwd, model: MODEL, scenario: "conversation" });

		expect(pool.readScopeCount()).toBe(2);
		expect(pool.readMcpScopeCount()).toBe(1);
		expect(createMcpRuntimeSource).toHaveBeenCalledTimes(1);
		expect(createMcpRuntimeSource).toHaveBeenCalledWith({ cwd: rootCwd, agentDir: undefined });
		await runtime.disposeAllSessions();
		await pool.dispose();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("reuses a prewarmed MCP source for the first runtime scope", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-mcp-prewarm-");
		const source = {
			refresh: async () => ({ tools: [] }),
		} satisfies McpRuntimeToolSource;
		const dispose = vi.fn(async () => undefined);
		const createMcpRuntimeSource = vi.fn(async () => ({ source, dispose }));
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
			},
			createMcpRuntimeSource,
		});
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(pool);
		runtimes.push(runtime);

		await pool.prewarmMcp({ cwd });
		await runtime.createSession({ cwd, model: MODEL, scenario: "batch" });

		expect(createMcpRuntimeSource).toHaveBeenCalledTimes(1);
		expect(pool.readMcpScopeCount()).toBe(1);
	});

	it("keeps the shared MCP source alive when one composition creation fails", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-mcp-failure-");
		const source = {
			refresh: async () => ({ tools: [] }),
		} satisfies McpRuntimeToolSource;
		const dispose = vi.fn(async () => undefined);
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
			},
			createMcpRuntimeSource: async () => ({ source, dispose }),
			createComposition: async () => {
				throw new Error("composition failed");
			},
		});
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(pool);
		runtimes.push(runtime);

		await expect(runtime.createSession({ cwd, model: MODEL, scenario: "batch" })).rejects.toThrow(
			"composition failed",
		);
		expect(dispose).not.toHaveBeenCalled();
		expect(pool.readScopeCount()).toBe(0);
		await pool.dispose();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	function createPool(): DesktopRuntimeBackendPool {
		return new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
			},
		});
	}

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

function modelRegistry(): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [MODEL],
		find: (provider, modelId) => (provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

const MODEL: Model<Api> = {
	id: "desktop-runtime-model",
	name: "Desktop Runtime Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
