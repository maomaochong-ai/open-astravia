import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { resolveCodingAgentSessionDir } from "@vetta/coding-agent/bootstrap";
import {
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition,
	createCodingAgentRuntimeSessionSelection,
	publishCodingAgentExecutionRuntimeDefinition,
} from "@vetta/coding-agent/composition";
import type { EcosystemHookAdapterFactory } from "@vetta/coding-agent/hooks";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import type { ConversationScenario } from "@vetta/coding-agent/profile";
import { CODING_AGENT_SESSION_PROFILE_STATE_READ } from "@vetta/coding-agent/session-extensions";
import {
	RuntimeHost as BaseRuntimeHost,
	RuntimeAgentRuntime,
	RuntimeObservationHub,
	type SessionConfig,
} from "@vetta/runtime-core";
import type { McpRuntimeToolSource } from "@vetta/runtime-mcp";
import { createInMemoryConversationPersistence } from "@vetta/runtime-node/conversation";
import type { CodingToolResultPolicy } from "@vetta/runtime-tools";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DesktopRuntimeBackendPool } from "./backend-pool.js";
import { DesktopRuntimeSessionCatalog } from "./session-catalog.js";

/** `getAgentDir()` 的环境变量开关；缺省会话落点由它决定，测试不得写进真实 `~/.vetta/agent`。 */
const AGENT_DIR_ENV = "VETTA_CODING_AGENT_DIR";

interface CodingAgentTestSessionConfig extends SessionConfig {
	readonly scenario?: ConversationScenario;
	readonly agentMode?: string;
	readonly appendSystemPrompt?: string;
	readonly enableBackgroundTasks?: boolean;
	readonly includeAgentSkills?: boolean;
}

class RuntimeHost extends BaseRuntimeHost {
	override createSession(config: CodingAgentTestSessionConfig = {}) {
		const {
			scenario = "cli",
			agentMode,
			appendSystemPrompt,
			enableBackgroundTasks,
			includeAgentSkills,
			...runtimeConfig
		} = config;
		return super.createSession({
			...runtimeConfig,
			agent: createCodingAgentRuntimeSessionSelection(
				{
					sessionId: config.sessionId,
					scenario,
					agentMode,
					systemPromptAddon: appendSystemPrompt,
					enableBackgroundTasks,
					includeAgentSkills,
				},
				config.agent,
			),
		});
	}
}

function resolveTestSystemPromptOptions() {
	return { customPrompt: "Test system prompt", scenario: "batch" as const };
}

describe("DesktopRuntimeBackendPool", () => {
	const directories: string[] = [];
	const runtimes: RuntimeHost[] = [];
	const pools: DesktopRuntimeBackendPool[] = [];
	const previousAgentDir = process.env[AGENT_DIR_ENV];
	let agentDir = "";

	beforeAll(async () => {
		agentDir = await mkdtemp(join(tmpdir(), "desktop-runtime-agent-dir-"));
		process.env[AGENT_DIR_ENV] = agentDir;
	});

	afterAll(async () => {
		if (previousAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
		else process.env[AGENT_DIR_ENV] = previousAgentDir;
		await rm(agentDir, { recursive: true, force: true });
	});

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
		expect(runtime.getState(first.sessionId).sessionId).toBe(first.sessionId);
		expect(runtime.getState(sameScope.sessionId).sessionId).toBe(sameScope.sessionId);
		expect(runtime.getState(second.sessionId).sessionId).toBe(second.sessionId);
		expect(
			runtime.invokeSessionExtensionSync(first.sessionId, CODING_AGENT_SESSION_PROFILE_STATE_READ, undefined)
				.scenario,
		).toBe("batch");
		expect(
			runtime.invokeSessionExtensionSync(second.sessionId, CODING_AGENT_SESSION_PROFILE_STATE_READ, undefined)
				.scenario,
		).toBe("automation");
	});

	it("owns one instance per session while sharing the workspace composition and MCP source", async () => {
		const cwd = await temporaryDirectory("desktop-session-instances-");
		const agents = new RuntimeAgentRuntime();
		publishCodingAgentExecutionRuntimeDefinition(agents);
		const disposeMcp = vi.fn(async () => undefined);
		const createMcpRuntimeSource = vi.fn(async () => ({
			source: { refresh: async () => ({ tools: [] }) },
			dispose: disposeMcp,
		}));
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				agentRuntime: { runtime: agents },
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
			},
			createMcpRuntimeSource,
		});
		const runtime = new RuntimeHost({ sessionBackend: pool, getDefaultExecutionMode: () => "full-access" });
		pools.push(pool);
		runtimes.push(runtime);
		try {
			const [first, second] = await Promise.all([
				runtime.createSession({ cwd, model: MODEL, scenario: "batch" }),
				runtime.createSession({ cwd, model: MODEL, scenario: "batch" }),
			]);
			const firstInstance = agents.getSession(first.sessionId)?.instanceId;
			const secondInstance = agents.getSession(second.sessionId)?.instanceId;
			expect(firstInstance).toBeDefined();
			expect(secondInstance).toBeDefined();
			expect(firstInstance).not.toBe(secondInstance);
			expect(pool.readScopeCount()).toBe(1);
			expect(createMcpRuntimeSource).toHaveBeenCalledOnce();

			await runtime.disposeSession(first.sessionId);
			expect(agents.getSession(first.sessionId)).toBeUndefined();
			expect(agents.getSession(second.sessionId)?.instanceId).toBe(secondInstance);
			expect(disposeMcp).not.toHaveBeenCalled();
			await runtime.disposeSession(second.sessionId);
			expect(agents.snapshot().instances).toEqual([]);
			expect(disposeMcp).not.toHaveBeenCalled();
			await pool.dispose();
			expect(disposeMcp).toHaveBeenCalledOnce();
		} finally {
			await runtime.disposeAllSessions();
			await pool.dispose();
			await agents.close();
		}
	});

	it("uses the RuntimeHost publisher as the sole Coding Agent observation upstream", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-observation-upstream-");
		const applicationHub = new RuntimeObservationHub();
		let observedRecordCount = 0;
		applicationHub.attach(
			{
				record: () => {
					observedRecordCount += 1;
				},
			},
			{ id: "test.application-observations" },
		);
		const observationPublisher = applicationHub.publisher();
		const onIssue = vi.fn();
		let capturedOptions: CodingAgentRuntimeCompositionOptions | undefined;
		const pool = new DesktopRuntimeBackendPool({
			observationPublisher,
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
				observationHub: {
					parent: applicationHub,
					maxPendingRecords: 32,
					onIssue,
				},
			},
			createComposition: async (options) => {
				capturedOptions = options;
				return await createCodingAgentRuntimeComposition(options);
			},
		});
		const runtime = new RuntimeHost({ sessionBackend: pool, getDefaultExecutionMode: () => "full-access" });
		pools.push(pool);
		runtimes.push(runtime);

		await expect(runtime.createSession({ cwd, model: MODEL, scenario: "batch" })).resolves.toMatchObject({
			sessionId: expect.any(String),
		});
		expect(capturedOptions?.observationPublisher).toBe(observationPublisher);
		expect(capturedOptions?.observationHub).toEqual({ maxPendingRecords: 32, onIssue });
		await vi.waitFor(() => expect(observedRecordCount).toBeGreaterThan(0));
	});

	/**
	 * 普通项目的会话产物**不落在用户工程目录里**：写进 `<cwd>/.vetta/sessions` 会在
	 * 用户仓库里长出未跟踪文件（还可能被 `git add -A` 误提交）。缺省落点是 agent 目录
	 * 下按 cwd 编码分片的全局目录，与 CLI/SDK 宿主一致。
	 */
	it("falls back to the global per-cwd session shard when sessionDir is omitted", async () => {
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
		const globalShard = resolveCodingAgentSessionDir(cwd);

		expect(dirname(runtime.getSessionPath(created.sessionId) ?? "")).toBe(globalShard);
		expect(existsSync(join(cwd, ".vetta", "sessions"))).toBe(false);

		const catalog = new DesktopRuntimeSessionCatalog({
			resolveRoots: () => [{ cwd, sessionDir: globalShard }],
		});
		const sessions = await catalog.listSessions(cwd);

		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			id: created.sessionId,
			cwd,
		});
	});

	it("still honours an explicit sessionDir (batch tasks, host-owned conversation roots)", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-explicit-dir-");
		const sessionDir = join(cwd, "custom-sessions");
		const pool = createPool();
		const runtime = new RuntimeHost({
			sessionBackend: pool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(pool);
		runtimes.push(runtime);

		const created = await runtime.createSession({ cwd, sessionDir, model: MODEL, scenario: "batch" });

		expect(dirname(runtime.getSessionPath(created.sessionId) ?? "")).toBe(sessionDir);
		// 显式落点不该被缺省值抢走：全局分片目录里不该多出这条会话。
		expect(await readdir(resolveCodingAgentSessionDir(cwd))).toHaveLength(0);
	});

	it("selects Node file persistence by default and honours an explicit host factory", async () => {
		const defaultCwd = await temporaryDirectory("desktop-runtime-default-persistence-");
		let capturedDefaultFactory: CodingAgentRuntimeCompositionOptions["createConversationPersistence"] | undefined;
		const defaultPool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
			},
			createComposition: async (options) => {
				capturedDefaultFactory = options.createConversationPersistence;
				return await createCodingAgentRuntimeComposition(options);
			},
		});
		const defaultRuntime = new RuntimeHost({
			sessionBackend: defaultPool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(defaultPool);
		runtimes.push(defaultRuntime);

		const created = await defaultRuntime.createSession({
			cwd: defaultCwd,
			model: MODEL,
			scenario: "batch",
		});
		const expectedConversationDir = resolveCodingAgentSessionDir(defaultCwd);
		expect(capturedDefaultFactory).toBeTypeOf("function");
		expect(dirname(defaultRuntime.getSessionPath(created.sessionId) ?? "")).toBe(expectedConversationDir);

		const overrideCwd = await temporaryDirectory("desktop-runtime-override-persistence-");
		const overrideFactory = vi.fn(() => createInMemoryConversationPersistence());
		let capturedOverrideFactory: CodingAgentRuntimeCompositionOptions["createConversationPersistence"] | undefined;
		const overridePool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
				createConversationPersistence: overrideFactory,
			},
			createComposition: async (options) => {
				capturedOverrideFactory = options.createConversationPersistence;
				return await createCodingAgentRuntimeComposition(options);
			},
		});
		const overrideRuntime = new RuntimeHost({
			sessionBackend: overridePool,
			getDefaultExecutionMode: () => "full-access",
		});
		pools.push(overridePool);
		runtimes.push(overrideRuntime);

		await overrideRuntime.createSession({ cwd: overrideCwd, model: MODEL, scenario: "batch" });
		expect(capturedOverrideFactory).toBe(overrideFactory);
		expect(overrideFactory).toHaveBeenCalledTimes(1);
	});

	it("forwards the scope-specific Tool Result policy from the Desktop composition root", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-result-policy-");
		const resultPolicy: CodingToolResultPolicy = { project: async (result) => result };
		const createCodingToolResultPolicy = vi.fn(() => resultPolicy);
		let capturedPolicy: CodingToolResultPolicy | undefined;
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
			},
			createCodingToolResultPolicy,
			createComposition: async (options) => {
				capturedPolicy = options.codingToolResultPolicy;
				return await createCodingAgentRuntimeComposition(options);
			},
		});
		const runtime = new RuntimeHost({ sessionBackend: pool, getDefaultExecutionMode: () => "full-access" });
		pools.push(pool);
		runtimes.push(runtime);

		await runtime.createSession({ cwd, agentDir, model: MODEL, scenario: "batch" });

		expect(createCodingToolResultPolicy).toHaveBeenCalledWith({ cwd, agentDir });
		expect(capturedPolicy).toBe(resultPolicy);
	});

	it("captures workspace facts at the Desktop composition boundary", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-workspace-facts-");
		await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "desktop-workspace" }), "utf-8");
		let capturedWorkspaceFacts: string | undefined;
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
			},
			createComposition: async (options) => {
				capturedWorkspaceFacts = options.workspaceFacts;
				return await createCodingAgentRuntimeComposition(options);
			},
		});
		const runtime = new RuntimeHost({ sessionBackend: pool, getDefaultExecutionMode: () => "full-access" });
		pools.push(pool);
		runtimes.push(runtime);

		await runtime.createSession({ cwd, model: MODEL, scenario: "batch" });

		expect(capturedWorkspaceFacts).toContain("`desktop-workspace`");
		expect(capturedWorkspaceFacts).toContain("Detected stack: Node.js.");
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

	it("retains scoped owners after a disposal failure and retries only unfinished resources", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-retry-dispose-");
		let disposeAttempts = 0;
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
			},
			createComposition: async (options) => {
				const composition = await createCodingAgentRuntimeComposition(options);
				return {
					...composition,
					async dispose() {
						disposeAttempts += 1;
						if (disposeAttempts === 1) throw new Error("transient composition close failure");
						await composition.dispose();
					},
				};
			},
		});
		const runtime = new RuntimeHost({ sessionBackend: pool, getDefaultExecutionMode: () => "full-access" });
		pools.push(pool);
		runtimes.push(runtime);
		await runtime.createSession({ cwd, model: MODEL, scenario: "batch" });
		await runtime.disposeAllSessions();

		await expect(pool.dispose()).rejects.toThrow("transient composition close failure");
		expect(pool.readScopeCount()).toBe(1);
		await expect(pool.dispose()).resolves.toBeUndefined();
		expect(pool.readScopeCount()).toBe(0);
		expect(disposeAttempts).toBe(2);
	});

	it("fails closed when a Coding-only scope receives another peer Agent selection", async () => {
		const cwd = await temporaryDirectory("desktop-runtime-agent-selection-");
		const pool = createPool();
		const runtime = new RuntimeHost({ sessionBackend: pool, getDefaultExecutionMode: () => "full-access" });
		pools.push(pool);
		runtimes.push(runtime);

		await expect(
			runtime.createSession({ cwd, model: MODEL, scenario: "batch", agent: { id: "reviewer" } }),
		).rejects.toThrow("cannot execute Agent reviewer");
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
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
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
		const createSessionHookAdapterFactories = vi.fn(() => [scopedFactory]);
		let capturedFactories: readonly EcosystemHookAdapterFactory[] | undefined;
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: {
				modelRegistry: modelRegistry(),
				initialModel: MODEL,
				initialThinkingLevel: "off",
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
				additionalHookAdapterFactories: [hostFactory],
			},
			createHookAdapterFactories,
			createSessionHookAdapterFactories,
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
		expect(createSessionHookAdapterFactories).toHaveBeenCalledWith(
			expect.objectContaining({ cwd, scenario: "batch" }),
			expect.objectContaining({ sessionId: expect.any(String), isPluginEnabled: expect.any(Function) }),
		);
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
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
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
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
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
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
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
				resolveSystemPromptOptions: resolveTestSystemPromptOptions,
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
