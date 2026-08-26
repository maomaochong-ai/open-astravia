import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import {
	InMemoryRuntimeSessionMarkerIndex,
	InMemoryRuntimeSessionValueIndex,
	type RuntimeModel,
	type RuntimeResourceContext,
	type RuntimeResources,
} from "@vetta/runtime-core";
import type { ConversationContinuationResult } from "@vetta/runtime-core/kernel";
import { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import {
	type CodingAgentSessionResourceIndexes,
	createCodingAgentSessionResourceLifecycle,
} from "../../src/composition/session-lifecycle/resource-lifecycle.js";
import type { CodingToolsRuntimeComposition } from "../../src/composition/tool-surface/runtime-tools-composition.js";
import type { CodingAgentTurnCapabilitySessionAssembly } from "../../src/composition/turn/capability-session-assembly.js";
import type { CodingAgentSessionExecutionRuntime } from "../../src/execution/session/runtime.js";
import type { CodingAgentExtensionRunBridge } from "../../src/extensions/runtime/extension-run-bridge.js";
import type { CodingAgentTodoRuntime } from "../../src/features/todo/contracts.js";
import type { CodingAgentSessionConfigurationState } from "../../src/host/session-configuration/configuration-state.js";
import type { CodingAgentMemoryController, CodingAgentMemoryRolloverRuntime } from "../../src/memory/index.js";
import type { CodingAgentPluginMcpRuntime } from "../../src/plugins/runtime/mcp-runtime.js";
import type {
	CodingAgentContextRuntime,
	CodingAgentRuntimeToolRegistration,
} from "../../src/runtime-contracts/index.js";
import type { CodingAgentConversationContextOverlay } from "../../src/sessions/projection/conversation-context-overlay.js";

describe("Coding Agent Session Resource Lifecycle", () => {
	it("atomically rebinds session resources and retries only failed cleanup phases", async () => {
		let activeSessionId = "source";
		let releaseAttempts = 0;
		let turnDisposals = 0;
		let executionDisposals = 0;
		let pluginDisposals = 0;
		let todoDisposals = 0;
		let contextDisposals = 0;
		const events: string[] = [];
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
		} as unknown as CodingAgentSessionExecutionRuntime;
		const configurationState = {} as CodingAgentSessionConfigurationState;
		const resourceContext = {} as RuntimeResourceContext;
		const extensionEvents = {} as CodingAgentExtensionRunBridge;
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
		const sessionExtensions = await SessionExtensionComposition.create({
			definitions: [
				{
					id: "test.todo",
					create: () => ({ contributions: [], dispose: () => todoRuntime.dispose() }),
				},
			],
		});
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
		} as unknown as CodingAgentTurnCapabilitySessionAssembly;
		const overlay = {
			clear(sessionId: string) {
				events.push(`clear:${sessionId}`);
			},
		} as unknown as CodingAgentConversationContextOverlay;
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
		const lifecycle = createCodingAgentSessionResourceLifecycle({
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
			modelRuntime: {} as RuntimeModel,
			contextRuntime,
			memoryRuntime,
			memoryController,
			sessionExtensions,
			todoToolRegistration: { tool: { name: "todo" } } as unknown as CodingAgentRuntimeToolRegistration,
			todoEnabled: true,
			executionRuntime,
			configurationState,
			pluginMcpRuntime,
			codingTools: {} as CodingToolsRuntimeComposition,
			specializedToolRegistrations: [],
			activation: { mode: "explicit", toolNames: [] },
			knowledgeAvailable: true,
			backgroundTasksAvailable: true,
			scenario: "cli",
		});
		const prepared = lifecycle.prepareTurnCapabilityAssembly(turnCapabilityAssembly);
		const resources = prepared.activate({
			snapshotProvider: {
				acquire: async () => {
					throw new Error("snapshot acquisition is not expected in this lifecycle test");
				},
			},
			acquirePreviewSnapshot: async () => {
				throw new Error("preview acquisition is not expected in this lifecycle test");
			},
			rebindSession: async (sessionId) => {
				events.push(`agent:${sessionId}`);
			},
			dispose: () => prepared.dispose(),
		});
		expect(indexes.extensionEventBridges.get("source")).toBe(extensionEvents);
		expect(indexes.memoryControllers.get("source")).toBe(memoryController);

		await resources.onConversationContinued?.(continuation("source", "target"));

		expect(events.slice(0, 6)).toEqual([
			"clear:source",
			"clear:target",
			"agent:target",
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
		await expect(prepared.dispose()).rejects.toThrow("transient release failure");
		expect([turnDisposals, executionDisposals, pluginDisposals, todoDisposals, contextDisposals]).toEqual([
			1, 1, 1, 1, 1,
		]);
		expect(indexes.executionRuntimes.get("target")).toBeUndefined();

		await expect(prepared.dispose()).resolves.toBeUndefined();
		expect(releaseAttempts).toBe(2);
		expect([turnDisposals, executionDisposals, pluginDisposals, todoDisposals, contextDisposals]).toEqual([
			1, 1, 1, 1, 1,
		]);
	});
});

function createIndexes(): CodingAgentSessionResourceIndexes {
	return {
		mcpControllers: new InMemoryRuntimeSessionValueIndex<McpDeferredToolController>(),
		pluginMcpRuntimes: new InMemoryRuntimeSessionValueIndex<CodingAgentPluginMcpRuntime>(),
		executionRuntimes: new InMemoryRuntimeSessionValueIndex<CodingAgentSessionExecutionRuntime>(),
		configurationStates: new InMemoryRuntimeSessionValueIndex<CodingAgentSessionConfigurationState>(),
		resourceContexts: new InMemoryRuntimeSessionValueIndex<RuntimeResourceContext>(),
		extensionEventBridges: new InMemoryRuntimeSessionValueIndex<CodingAgentExtensionRunBridge>(),
		memoryControllers: new InMemoryRuntimeSessionValueIndex<CodingAgentMemoryController>(),
		hookSessionControllers: new InMemoryRuntimeSessionValueIndex(),
		mcpRefreshObservedSessions: new InMemoryRuntimeSessionMarkerIndex(),
	};
}

function createConversationResources() {
	const storage = {} as RuntimeResources["repository"];
	return {
		repository: storage,
		documentStore: storage as unknown as RuntimeResources["conversationDocumentStore"],
		continuationStore: storage as unknown as NonNullable<RuntimeResources["conversationContinuationStore"]>,
		resolveConversationPath: (sessionId: string) => `C:\\conversations\\${sessionId}.jsonl`,
		resolveSessionDirectory: (_sessionId: string) => "C:\\conversations",
		resolveSessionPath: (sessionId: string) => `C:\\conversations\\${sessionId}.jsonl`,
	};
}

function continuation(sourceSessionId: string, sessionId: string): ConversationContinuationResult {
	return { sourceSessionId, sessionId } as unknown as ConversationContinuationResult;
}
