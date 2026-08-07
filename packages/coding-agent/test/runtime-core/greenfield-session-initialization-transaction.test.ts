import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import type { ModelCallFrameCompositionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { ConversationOwnershipManager } from "@vetta/runtime-storage/conversation";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentRuntimeModelSource } from "../../src/adapters/runtime-core/greenfield-model-runtime-adapter.js";
import type { CodingAgentPluginMcpRuntime } from "../../src/adapters/runtime-core/greenfield-plugin-mcp-runtime.js";
import { CodingAgentTodoRuntime } from "../../src/adapters/runtime-core/greenfield-todo-runtime.js";
import { createGreenfieldRuntimeComposition } from "../../src/composition/greenfield-runtime-composition.js";
import { CodingAgentMemoryRolloverOrchestrator } from "../../src/memory/index.js";

describe("Greenfield Session Initialization Transaction", () => {
	it("rolls back acquired resources in reverse order and allows the same Session to restart", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "greenfield-session-initialization-"));
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
		const composition = await createGreenfieldRuntimeComposition({
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
				const runtime = new CodingAgentMemoryRolloverOrchestrator(options);
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
			createSystemPromptOptionsResolver: () => () => {
				promptAttempts += 1;
				if (promptAttempts === 1) throw new Error("initial prompt preview failed");
				return { customPrompt: "test", scenario: "cli" };
			},
		});

		try {
			await expect(composition.backend.create({ sessionId: "session", memoryMode: true })).rejects.toThrow(
				"initial prompt preview failed",
			);
			expect(rollbackOrder).toEqual(["todo", "memory", "plugin-mcp", "ownership"]);
			expect(activeOwnerships).toBe(0);
			expect(pluginRuntimes).toHaveLength(1);
			expect(memoryRuntimes[0]?.dispose).toHaveBeenCalledOnce();
			expect(todoRuntimes[0]?.dispose).toHaveBeenCalledOnce();

			rollbackOrder.length = 0;
			const session = await composition.backend.create({ sessionId: "session", memoryMode: true });
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
		const conversationDir = await mkdtemp(join(tmpdir(), "greenfield-session-peripheral-"));
		const rollbackOrder: string[] = [];
		const pluginRuntime = createPluginMcpRuntime(rollbackOrder);
		vi.spyOn(pluginRuntime, "reconfigure").mockRejectedValue(new Error("plugin MCP reconfiguration failed"));
		const composition = await createGreenfieldRuntimeComposition({
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
			await expect(composition.backend.create({ sessionId: "session" })).rejects.toThrow(
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
