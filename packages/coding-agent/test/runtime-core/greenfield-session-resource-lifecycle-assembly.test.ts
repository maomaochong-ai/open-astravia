import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type {
	GreenfieldRuntimeModel,
	GreenfieldRuntimeResourceContext,
	GreenfieldRuntimeResources,
} from "@vetta/runtime-core";
import type { ConversationContinuationResult } from "@vetta/runtime-core/kernel";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentContextRuntime } from "../../src/adapters/runtime-core/context-runtime/index.js";
import type { CodingAgentGreenfieldConversationContextOverlay } from "../../src/adapters/runtime-core/greenfield-conversation-context-overlay.js";
import type { CodingAgentGreenfieldExtensionEventBridge } from "../../src/adapters/runtime-core/greenfield-extension-event-bridge.js";
import type { CodingAgentMemoryController } from "../../src/adapters/runtime-core/greenfield-memory-controller.js";
import type { CodingAgentPluginMcpRuntime } from "../../src/adapters/runtime-core/greenfield-plugin-mcp-runtime.js";
import type { CodingAgentTodoRuntime } from "../../src/adapters/runtime-core/greenfield-todo-runtime.js";
import type { GreenfieldSessionExecutionRuntime } from "../../src/composition/greenfield-session-execution-runtime.js";
import type { GreenfieldSessionConfigurationState } from "../../src/composition/greenfield-session-peripherals.js";
import {
	InMemoryGreenfieldSessionMarkerIndex,
	InMemoryGreenfieldSessionValueIndex,
} from "../../src/composition/greenfield-session-resource-index.js";
import {
	createGreenfieldSessionResourceLifecycleAssembly,
	type GreenfieldSessionResourceIndexes,
} from "../../src/composition/greenfield-session-resource-lifecycle-assembly.js";
import type { GreenfieldTurnCapabilitySessionAssembly } from "../../src/composition/greenfield-turn-capability-session-assembly.js";
import type { CodingToolsRuntimeComposition } from "../../src/composition/runtime-tools-composition.js";
import type { CodingAgentMemoryRolloverRuntime } from "../../src/memory/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../src/runtime-contracts/index.js";

describe("Greenfield Session Resource Lifecycle assembly", () => {
	it("atomically rebinds session resources and retries only failed cleanup phases", async () => {
		let activeSessionId = "source";
		let releaseAttempts = 0;
		let turnDisposals = 0;
		let executionDisposals = 0;
		let pluginDisposals = 0;
		let todoDisposals = 0;
		let contextDisposals = 0;
		const events: string[] = [];
		const hookDisposers = new Set<() => Promise<void>>();
		const indexes = createIndexes();
		const pluginMcpRuntime = {
			async dispose() {
				pluginDisposals += 1;
			},
		} as unknown as CodingAgentPluginMcpRuntime;
		const executionRuntime = {
			async dispose() {
				executionDisposals += 1;
			},
		} as unknown as GreenfieldSessionExecutionRuntime;
		const configurationState = {} as GreenfieldSessionConfigurationState;
		const resourceContext = {} as GreenfieldRuntimeResourceContext;
		const extensionEvents = {} as CodingAgentGreenfieldExtensionEventBridge;
		const memoryController = {} as CodingAgentMemoryController;
		const memoryRuntime = {
			dispose: vi.fn(),
		} as unknown as CodingAgentMemoryRolloverRuntime;
		const contextRuntime = {
			dispose() {
				contextDisposals += 1;
			},
		} as unknown as CodingAgentContextRuntime;
		const todoRuntime = {
			async dispose() {
				todoDisposals += 1;
			},
		} as unknown as CodingAgentTodoRuntime;
		const turnCapabilityAssembly = {
			rebindSession(sessionId: string) {
				events.push(`turn:${sessionId}`);
			},
			async dispose() {
				turnDisposals += 1;
			},
			capabilities: {},
			promptAdapter: {},
			readAvailableTools: () => new Map(),
			readPluginActiveToolNames: () => undefined,
		} as unknown as GreenfieldTurnCapabilitySessionAssembly;
		const overlay = {
			clear(sessionId: string) {
				events.push(`clear:${sessionId}`);
			},
		} as unknown as CodingAgentGreenfieldConversationContextOverlay;
		const hookRuntime = {
			async runSessionEnd(cause: string) {
				events.push(`end:${cause}`);
			},
			markSessionStart(source: string) {
				events.push(`start:${source}`);
			},
		} as unknown as EcosystemHookRuntime;

		indexes.pluginMcpRuntimes.set(activeSessionId, pluginMcpRuntime);
		indexes.executionRuntimes.set(activeSessionId, executionRuntime);
		indexes.configurationStates.set(activeSessionId, configurationState);
		indexes.resourceContexts.set(activeSessionId, resourceContext);
		const lifecycle = createGreenfieldSessionResourceLifecycleAssembly({
			session: {
				initialSessionId: activeSessionId,
				readSessionId: () => activeSessionId,
				commitSessionId(sessionId) {
					events.push(`commit:${sessionId}`);
					activeSessionId = sessionId;
				},
				cwd: "C:\\workspace",
			},
			conversation: createConversationResources(),
			ownership: {
				async rebind(sessionId) {
					events.push(`ownership:${sessionId}`);
				},
				async release() {
					releaseAttempts += 1;
					if (releaseAttempts === 1) throw new Error("transient release failure");
				},
			},
			resourceContext,
			indexes,
			hookRuntime,
			extensionEvents,
			conversationContextOverlay: overlay,
			modelRuntime: {} as GreenfieldRuntimeModel,
			contextRuntime,
			memoryRuntime,
			memoryController,
			todoRuntime,
			todoToolRegistration: { tool: { name: "todo" } } as unknown as CodingAgentRuntimeToolRegistration,
			todoEnabled: true,
			executionRuntime,
			configurationState,
			pluginMcpRuntime,
			codingTools: {} as CodingToolsRuntimeComposition,
			productToolRegistrations: [],
			activation: { mode: "explicit", toolNames: [] },
			knowledgeAvailable: true,
			backgroundTasksAvailable: true,
			scenario: "cli",
			refreshSessionMcp: async () => undefined,
			tracking: {
				trackHookSessionDisposer: (dispose) => hookDisposers.add(dispose),
				untrackHookSessionDisposer: (dispose) => hookDisposers.delete(dispose),
				untrackContextRuntime: () => {},
				untrackMemoryRuntime: () => {},
				untrackTodoRuntime: () => {},
				untrackTurnCapabilityAssembly: () => {},
			},
		});
		const resources = lifecycle.attachTurnCapabilityAssembly(turnCapabilityAssembly);
		expect(hookDisposers).toHaveLength(1);
		expect(indexes.extensionEventBridges.get("source")).toBe(extensionEvents);
		expect(indexes.memoryControllers.get("source")).toBe(memoryController);

		await resources.onConversationContinued?.(continuation("source", "target"));

		expect(events.slice(0, 5)).toEqual([
			"clear:source",
			"clear:target",
			"ownership:target",
			"commit:target",
			"turn:target",
		]);
		expect(indexes.pluginMcpRuntimes.get("source")).toBeUndefined();
		expect(indexes.pluginMcpRuntimes.get("target")).toBe(pluginMcpRuntime);
		expect(indexes.executionRuntimes.get("target")).toBe(executionRuntime);
		expect(indexes.extensionEventBridges.get("target")).toBe(extensionEvents);

		await lifecycle.hookController.end("switch_session");
		lifecycle.hookController.start("resume");
		expect(hookDisposers).toHaveLength(1);
		await expect(disposeResources(resources)).rejects.toThrow("transient release failure");
		expect([turnDisposals, executionDisposals, pluginDisposals, todoDisposals, contextDisposals]).toEqual([
			1, 1, 1, 1, 1,
		]);
		expect(indexes.executionRuntimes.get("target")).toBeUndefined();
		expect(hookDisposers).toHaveLength(0);

		await expect(disposeResources(resources)).resolves.toBeUndefined();
		expect(releaseAttempts).toBe(2);
		expect([turnDisposals, executionDisposals, pluginDisposals, todoDisposals, contextDisposals]).toEqual([
			1, 1, 1, 1, 1,
		]);
	});
});

function createIndexes(): GreenfieldSessionResourceIndexes {
	return {
		mcpControllers: new InMemoryGreenfieldSessionValueIndex<McpDeferredToolController>(),
		pluginMcpRuntimes: new InMemoryGreenfieldSessionValueIndex<CodingAgentPluginMcpRuntime>(),
		executionRuntimes: new InMemoryGreenfieldSessionValueIndex<GreenfieldSessionExecutionRuntime>(),
		configurationStates: new InMemoryGreenfieldSessionValueIndex<GreenfieldSessionConfigurationState>(),
		resourceContexts: new InMemoryGreenfieldSessionValueIndex<GreenfieldRuntimeResourceContext>(),
		extensionEventBridges: new InMemoryGreenfieldSessionValueIndex<CodingAgentGreenfieldExtensionEventBridge>(),
		memoryControllers: new InMemoryGreenfieldSessionValueIndex<CodingAgentMemoryController>(),
		hookSessionControllers: new InMemoryGreenfieldSessionValueIndex(),
		mcpRefreshObservedSessions: new InMemoryGreenfieldSessionMarkerIndex(),
		mcpPromptRefreshReuseSessions: new InMemoryGreenfieldSessionMarkerIndex(),
	};
}

function createConversationResources() {
	const storage = {} as GreenfieldRuntimeResources["repository"];
	return {
		repository: storage,
		documentStore: storage as unknown as GreenfieldRuntimeResources["conversationDocumentStore"],
		continuationStore: storage as unknown as NonNullable<GreenfieldRuntimeResources["conversationContinuationStore"]>,
		resolveConversationPath: (sessionId: string) => `C:\\conversations\\${sessionId}.jsonl`,
		resolveSessionPath: (sessionId: string) => `C:\\conversations\\${sessionId}.jsonl`,
	};
}

function continuation(sourceSessionId: string, sessionId: string): ConversationContinuationResult {
	return { sourceSessionId, sessionId } as unknown as ConversationContinuationResult;
}

async function disposeResources(resources: GreenfieldRuntimeResources): Promise<void> {
	if (!resources.dispose) throw new Error("Expected resource disposal");
	await resources.dispose();
}
