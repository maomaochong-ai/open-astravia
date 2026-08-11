import type { RuntimeResourceContext } from "@vetta/runtime-core";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import type { CodingAgentExtensionRunAdapter } from "../../adapters/runtime-core/extension-run-adapter.js";
import type { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import type { CodingAgentSessionExecutionRuntime } from "../../host/session-execution/execution-runtime.js";
import type { CodingAgentMemoryController } from "../../memory/index.js";
import type { CodingAgentPluginMcpRuntime } from "../../runtime-contracts/index.js";
import { InMemoryCodingAgentSessionMarkerIndex, InMemoryCodingAgentSessionValueIndex } from "./indexes.js";
import type { CodingAgentSessionHookController, CodingAgentSessionResourceIndexes } from "./resource-lifecycle.js";

export interface CodingAgentSynchronousDisposableResource {
	dispose(): void;
}

export interface CodingAgentAsynchronousDisposableResource {
	dispose(): Promise<void>;
}

export interface CodingAgentCompositionResourceCleanupSnapshot {
	readonly contextRuntimes: readonly CodingAgentSynchronousDisposableResource[];
	readonly memoryRuntimes: readonly CodingAgentSynchronousDisposableResource[];
	readonly executionRuntimes: readonly CodingAgentAsynchronousDisposableResource[];
	readonly hookSessionDisposers: readonly (() => Promise<void>)[];
	readonly todoRuntimes: readonly CodingAgentAsynchronousDisposableResource[];
	readonly turnCapabilityAssemblies: readonly CodingAgentAsynchronousDisposableResource[];
	readonly ownershipBindings: readonly CodingAgentAsynchronousDisposableResource[];
	readonly pluginMcpRuntimes: readonly CodingAgentAsynchronousDisposableResource[];
}

export interface CodingAgentCompositionResourceCleanupRegistry {
	readCleanupSnapshot(): CodingAgentCompositionResourceCleanupSnapshot;
	untrackContextRuntime(runtime: CodingAgentSynchronousDisposableResource): void;
	untrackMemoryRuntime(runtime: CodingAgentSynchronousDisposableResource): void;
	untrackHookSessionDisposer(dispose: () => Promise<void>): void;
	untrackTodoRuntime(runtime: CodingAgentAsynchronousDisposableResource): void;
	untrackTurnCapabilityAssembly(assembly: CodingAgentAsynchronousDisposableResource): void;
	untrackOwnershipBinding(binding: CodingAgentAsynchronousDisposableResource): void;
	unbindExecutionRuntime(runtime: CodingAgentAsynchronousDisposableResource): void;
	unbindPluginMcpRuntime(runtime: CodingAgentAsynchronousDisposableResource): void;
	clearAuxiliarySessionIndexes(): void;
}

/** Composition 级 Session 索引与唯一资源身份登记；不负责创建或释放资源。 */
export class CodingAgentCompositionResourceRegistry implements CodingAgentCompositionResourceCleanupRegistry {
	readonly indexes: CodingAgentSessionResourceIndexes = {
		mcpControllers: new InMemoryCodingAgentSessionValueIndex<McpDeferredToolController>(),
		pluginMcpRuntimes: new InMemoryCodingAgentSessionValueIndex<CodingAgentPluginMcpRuntime>(),
		executionRuntimes: new InMemoryCodingAgentSessionValueIndex<CodingAgentSessionExecutionRuntime>(),
		configurationStates: new InMemoryCodingAgentSessionValueIndex<CodingAgentSessionConfigurationState>(),
		resourceContexts: new InMemoryCodingAgentSessionValueIndex<RuntimeResourceContext>(),
		extensionEventBridges: new InMemoryCodingAgentSessionValueIndex<CodingAgentExtensionRunAdapter>(),
		memoryControllers: new InMemoryCodingAgentSessionValueIndex<CodingAgentMemoryController>(),
		hookSessionControllers: new InMemoryCodingAgentSessionValueIndex<CodingAgentSessionHookController>(),
		mcpRefreshObservedSessions: new InMemoryCodingAgentSessionMarkerIndex(),
		mcpPromptRefreshReuseSessions: new InMemoryCodingAgentSessionMarkerIndex(),
	};

	private readonly contextRuntimes = new Set<CodingAgentSynchronousDisposableResource>();
	private readonly memoryRuntimes = new Set<CodingAgentSynchronousDisposableResource>();
	private readonly hookSessionDisposers = new Set<() => Promise<void>>();
	private readonly todoRuntimes = new Set<CodingAgentAsynchronousDisposableResource>();
	private readonly turnCapabilityAssemblies = new Set<CodingAgentAsynchronousDisposableResource>();
	private readonly ownershipBindings = new Set<CodingAgentAsynchronousDisposableResource>();

	trackContextRuntime(runtime: CodingAgentSynchronousDisposableResource): void {
		this.contextRuntimes.add(runtime);
	}

	untrackContextRuntime(runtime: CodingAgentSynchronousDisposableResource): void {
		this.contextRuntimes.delete(runtime);
	}

	trackMemoryRuntime(runtime: CodingAgentSynchronousDisposableResource): void {
		this.memoryRuntimes.add(runtime);
	}

	untrackMemoryRuntime(runtime: CodingAgentSynchronousDisposableResource): void {
		this.memoryRuntimes.delete(runtime);
	}

	trackHookSessionDisposer(dispose: () => Promise<void>): void {
		this.hookSessionDisposers.add(dispose);
	}

	untrackHookSessionDisposer(dispose: () => Promise<void>): void {
		this.hookSessionDisposers.delete(dispose);
	}

	trackTodoRuntime(runtime: CodingAgentAsynchronousDisposableResource): void {
		this.todoRuntimes.add(runtime);
	}

	untrackTodoRuntime(runtime: CodingAgentAsynchronousDisposableResource): void {
		this.todoRuntimes.delete(runtime);
	}

	trackTurnCapabilityAssembly(assembly: CodingAgentAsynchronousDisposableResource): void {
		this.turnCapabilityAssemblies.add(assembly);
	}

	untrackTurnCapabilityAssembly(assembly: CodingAgentAsynchronousDisposableResource): void {
		this.turnCapabilityAssemblies.delete(assembly);
	}

	trackOwnershipBinding(binding: CodingAgentAsynchronousDisposableResource): void {
		this.ownershipBindings.add(binding);
	}

	untrackOwnershipBinding(binding: CodingAgentAsynchronousDisposableResource): void {
		this.ownershipBindings.delete(binding);
	}

	readCleanupSnapshot(): CodingAgentCompositionResourceCleanupSnapshot {
		return {
			contextRuntimes: Object.freeze([...this.contextRuntimes]),
			memoryRuntimes: Object.freeze([...this.memoryRuntimes]),
			executionRuntimes: Object.freeze([...new Set(this.indexes.executionRuntimes.values())]),
			hookSessionDisposers: Object.freeze([...this.hookSessionDisposers]),
			todoRuntimes: Object.freeze([...this.todoRuntimes]),
			turnCapabilityAssemblies: Object.freeze([...this.turnCapabilityAssemblies]),
			ownershipBindings: Object.freeze([...this.ownershipBindings]),
			pluginMcpRuntimes: Object.freeze([...new Set(this.indexes.pluginMcpRuntimes.values())]),
		};
	}

	unbindExecutionRuntime(runtime: CodingAgentAsynchronousDisposableResource): void {
		for (const [sessionId, registered] of this.indexes.executionRuntimes.entries()) {
			if (registered === runtime) this.indexes.executionRuntimes.delete(sessionId);
		}
	}

	unbindPluginMcpRuntime(runtime: CodingAgentAsynchronousDisposableResource): void {
		for (const [sessionId, registered] of this.indexes.pluginMcpRuntimes.entries()) {
			if (registered === runtime) this.indexes.pluginMcpRuntimes.delete(sessionId);
		}
	}

	clearAuxiliarySessionIndexes(): void {
		this.indexes.memoryControllers.clear();
		this.indexes.resourceContexts.clear();
		this.indexes.extensionEventBridges.clear();
		this.indexes.mcpRefreshObservedSessions.clear();
		this.indexes.mcpPromptRefreshReuseSessions.clear();
		this.indexes.hookSessionControllers.clear();
		this.indexes.mcpControllers.clear();
		this.indexes.configurationStates.clear();
	}
}
