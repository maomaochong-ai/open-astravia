import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { RuntimeObservationHub, type RuntimeObservationRecord } from "@vetta/runtime-core";
import type { ModelCallFrameCompositionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { ConversationOwnershipManager } from "@vetta/runtime-storage/conversation";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentRuntimeModelSource } from "../../src/adapters/runtime-core/model-runtime-adapter.js";
import { CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION } from "../../src/composition/contracts/session-initialization-observability.js";
import { CodingAgentTodoRuntime } from "../../src/features/todo/todo-runtime.js";
import { CodingAgentMemoryRolloverOrchestrator } from "../../src/memory/index.js";
import type { CodingAgentPluginMcpRuntime } from "../../src/plugins/runtime/mcp-runtime.js";
import { createCodingAgentRuntimeComposition } from "../fixtures/conversation-persistence.js";
import { createMemoryTextStorage } from "../fixtures/memory-storage.js";

describe("Coding Agent Session Initialization Transaction", () => {
	it("closes its owned observation Hub when Composition assembly fails", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "coding-agent-observation-rollback-"));
		const flush = vi.fn(async () => {});
		try {
			await expect(
				createCodingAgentRuntimeComposition({
					conversationDir,
					modelRegistry: modelRegistry(),
					initialModel: MODEL,
					initialThinkingLevel: "off",
					enableSubagents: false,
					activation: { mode: "explicit", toolNames: [] },
					createToolEnvironment: () => {
						throw new Error("tool environment assembly failed");
					},
					observationHub: {
						routes: [{ port: { record() {}, flush }, route: { id: "local" } }],
					},
				}),
			).rejects.toThrow("tool environment assembly failed");
			expect(flush).toHaveBeenCalledOnce();
		} finally {
			await rm(conversationDir, { force: true, recursive: true });
		}
	});

	it("publishes real initialization observations through its owned child Hub", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "coding-agent-observation-hub-"));
		const parentRecords: RuntimeObservationRecord[] = [];
		const localRecords: RuntimeObservationRecord[] = [];
		const parent = new RuntimeObservationHub();
		parent.attach(
			{
				record: (record) => {
					parentRecords.push(record);
				},
			},
			{ id: "parent" },
		);
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			observationHub: { parent },
		});
		const localRoute = composition.observations.attach(
			{
				record: (record) => {
					localRecords.push(record);
				},
			},
			{
				id: "local",
				domains: [CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION.domain],
			},
		);

		try {
			const session = await composition.createSession({ sessionId: "observed-session" });
			await parent.flush();
			const parentInitialization = parentRecords.filter(
				({ token }) => token === CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
			);
			expect(parentInitialization.length).toBeGreaterThan(1);
			expect(localRecords).toEqual(parentInitialization);
			expect(parentInitialization.at(-1)).toMatchObject({
				context: { sessionId: "observed-session" },
				payload: { status: "completed" },
			});
			expect(composition.observations.snapshot()).toMatchObject({ closed: false });
			expect(localRoute.detach()).toBe(true);
			await session.dispose();
		} finally {
			await composition.dispose().catch(() => undefined);
			await rm(conversationDir, { force: true, recursive: true });
		}
		expect(composition.observations.snapshot().closed).toBe(true);
		expect(parent.snapshot().closed).toBe(false);
	});

	it("creates platform specialized tools with the current Session context", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "coding-agent-specialized-tool-host-"));
		const createSpecializedToolRegistrations = vi.fn(() => []);
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			agentDir: "C:/agent-home",
			createToolEnvironment: () => ({
				registrations: [],
				createSpecializedToolRegistrations,
				dispose() {},
			}),
		});

		try {
			const first = await composition.createSession({ sessionId: "first", cwd: "C:/first-workspace" });
			const second = await composition.createSession({ sessionId: "second", cwd: "C:/second-workspace" });
			expect(createSpecializedToolRegistrations).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					cwd: "C:/first-workspace",
					agentDir: "C:/agent-home",
					scenario: "cli",
					ocrExecutionGate: expect.objectContaining({ run: expect.any(Function) }),
				}),
			);
			expect(createSpecializedToolRegistrations).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ cwd: "C:/second-workspace" }),
			);
			await Promise.all([first.dispose(), second.dispose()]);
		} finally {
			await composition.dispose().catch(() => undefined);
			await rm(conversationDir, { force: true, recursive: true });
		}
	});

	it("rolls back acquired resources in reverse order and allows the same Session to restart", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "coding-agent-session-initialization-"));
		const rollbackOrder: string[] = [];
		const pluginRuntimes: CodingAgentPluginMcpRuntime[] = [];
		const memoryRuntimes: CodingAgentMemoryRolloverOrchestrator[] = [];
		const todoRuntimes: CodingAgentTodoRuntime[] = [];
		let activeOwnerships = 0;
		let promptAttempts = 0;
		const ownershipManager: ConversationOwnershipManager = {
			acquire: async (conversationPath) => {
				if (activeOwnerships > 0) throw new Error("previous initialization ownership was not released");
				activeOwnerships += 1;
				return {
					conversationPath,
					lockPath: `${conversationPath}.owner.lock`,
					holder: {
						token: "owner",
						pid: 1,
						hostname: "test",
						acquiredAt: new Date(0).toISOString(),
					},
					release: async () => {
						rollbackOrder.push("ownership");
						activeOwnerships -= 1;
					},
				};
			},
		};
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			conversationOwnershipManager: ownershipManager,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			createPluginMcpRuntime: async () => {
				const runtime = createPluginMcpRuntime(rollbackOrder);
				pluginRuntimes.push(runtime);
				return runtime;
			},
			createMemoryRolloverRuntime: (options) => {
				const runtime = new CodingAgentMemoryRolloverOrchestrator({
					...options,
					memoryFile: options.memoryFile ?? "MEMORY.md",
					memoryStorage: createMemoryTextStorage(),
					journalStorage: createMemoryTextStorage(),
				});
				const dispose = runtime.dispose.bind(runtime);
				vi.spyOn(runtime, "dispose").mockImplementation(() => {
					rollbackOrder.push("memory");
					dispose();
				});
				memoryRuntimes.push(runtime);
				return runtime;
			},
			createTodoRuntime: () => {
				const runtime = new CodingAgentTodoRuntime();
				const dispose = runtime.dispose.bind(runtime);
				vi.spyOn(runtime, "dispose").mockImplementation(async () => {
					rollbackOrder.push("todo");
					await dispose();
				});
				todoRuntimes.push(runtime);
				return runtime;
			},
			createSessionExtensionDefinitions: () => [
				{
					id: "test.session-extension",
					create: () => ({
						contributions: [],
						dispose() {
							rollbackOrder.push("session-extension");
						},
					}),
				},
			],
			createSystemPromptOptionsResolver: () => () => {
				promptAttempts += 1;
				if (promptAttempts === 1) throw new Error("initial prompt preview failed");
				return { customPrompt: "test", scenario: "cli" };
			},
		});

		try {
			await expect(composition.createSession({ sessionId: "session", memoryMode: true })).rejects.toThrow(
				"initial prompt preview failed",
			);
			expect(rollbackOrder).toEqual(["session-extension", "todo", "memory", "plugin-mcp", "ownership"]);
			expect(activeOwnerships).toBe(0);
			expect(pluginRuntimes).toHaveLength(1);
			expect(memoryRuntimes[0]?.dispose).toHaveBeenCalledOnce();
			expect(todoRuntimes[0]?.dispose).toHaveBeenCalledOnce();

			rollbackOrder.length = 0;
			const session = await composition.createSession({ sessionId: "session", memoryMode: true });
			expect(activeOwnerships).toBe(1);
			await session.dispose();
			expect(activeOwnerships).toBe(0);
			expect(pluginRuntimes).toHaveLength(2);
			expect(memoryRuntimes).toHaveLength(2);
			expect(todoRuntimes).toHaveLength(2);
			expect(memoryRuntimes[1]?.dispose).toHaveBeenCalledOnce();
			expect(todoRuntimes[1]?.dispose).toHaveBeenCalled();
		} finally {
			await composition.dispose().catch(() => undefined);
			await rm(conversationDir, { force: true, recursive: true });
		}
	});

	it("rolls back a partially assembled peripheral stage when plugin MCP reconfiguration fails", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "coding-agent-session-peripheral-"));
		const rollbackOrder: string[] = [];
		const pluginRuntime = createPluginMcpRuntime(rollbackOrder);
		vi.spyOn(pluginRuntime, "reconfigure").mockRejectedValue(new Error("plugin MCP reconfiguration failed"));
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			createPluginMcpRuntime: async () => pluginRuntime,
			createSystemPromptOptionsResolver: () => () => ({ customPrompt: "test", scenario: "cli" }),
		});

		try {
			await expect(composition.createSession({ sessionId: "session" })).rejects.toThrow(
				"plugin MCP reconfiguration failed",
			);
			expect(rollbackOrder).toEqual(["plugin-mcp"]);
			expect(pluginRuntime.dispose).toHaveBeenCalledOnce();
		} finally {
			await composition.dispose().catch(() => undefined);
			await rm(conversationDir, { force: true, recursive: true });
		}
	});
});

function createPluginMcpRuntime(rollbackOrder: string[]): CodingAgentPluginMcpRuntime {
	const snapshot = Object.freeze({ revision: 0, tools: Object.freeze([]) });
	return {
		reconfigure: vi.fn(async () => {}),
		refresh: vi.fn(async () => snapshot),
		snapshot: () => snapshot,
		view: () => Object.freeze({ tools: Object.freeze([]) }),
		isManagedTool: () => false,
		compose: (
			context: ModelCallFrameCompositionContext,
			availableTools: ReadonlyMap<string, RuntimeToolDefinition>,
		) => ({ frame: context.frame, availableTools }),
		dispose: vi.fn(async () => {
			rollbackOrder.push("plugin-mcp");
		}),
	} as unknown as CodingAgentPluginMcpRuntime;
}

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
	id: "recorded-model",
	name: "Recorded Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
