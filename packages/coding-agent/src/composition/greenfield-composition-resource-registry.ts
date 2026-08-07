import type { GreenfieldRuntimeResourceContext } from "@vetta/runtime-core";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import type { CodingAgentGreenfieldExtensionEventBridge } from "../adapters/runtime-core/greenfield-extension-event-bridge.js";
import type { CodingAgentMemoryController } from "../adapters/runtime-core/greenfield-memory-controller.js";
import type { CodingAgentPluginMcpRuntime } from "../runtime-contracts/index.js";
import type { GreenfieldSessionExecutionRuntime } from "./greenfield-session-execution-runtime.js";
import type { GreenfieldSessionConfigurationState } from "./greenfield-session-peripherals.js";
import {
	InMemoryGreenfieldSessionMarkerIndex,
	InMemoryGreenfieldSessionValueIndex,
} from "./greenfield-session-resource-index.js";
import type {
	GreenfieldSessionHookController,
	GreenfieldSessionResourceIndexes,
} from "./greenfield-session-resource-lifecycle-assembly.js";

export interface GreenfieldSynchronousDisposableResource {
	dispose(): void;
}

export interface GreenfieldAsynchronousDisposableResource {
	dispose(): Promise<void>;
}

export interface GreenfieldCompositionResourceCleanupSnapshot {
	readonly contextRuntimes: readonly GreenfieldSynchronousDisposableResource[];
	readonly memoryRuntimes: readonly GreenfieldSynchronousDisposableResource[];
	readonly executionRuntimes: readonly GreenfieldAsynchronousDisposableResource[];
	readonly hookSessionDisposers: readonly (() => Promise<void>)[];
	readonly todoRuntimes: readonly GreenfieldAsynchronousDisposableResource[];
	readonly turnCapabilityAssemblies: readonly GreenfieldAsynchronousDisposableResource[];
	readonly ownershipBindings: readonly GreenfieldAsynchronousDisposableResource[];
	readonly pluginMcpRuntimes: readonly GreenfieldAsynchronousDisposableResource[];
}

export interface GreenfieldCompositionResourceCleanupRegistry {
	readCleanupSnapshot(): GreenfieldCompositionResourceCleanupSnapshot;
	untrackContextRuntime(runtime: GreenfieldSynchronousDisposableResource): void;
	untrackMemoryRuntime(runtime: GreenfieldSynchronousDisposableResource): void;
	untrackHookSessionDisposer(dispose: () => Promise<void>): void;
	untrackTodoRuntime(runtime: GreenfieldAsynchronousDisposableResource): void;
	untrackTurnCapabilityAssembly(assembly: GreenfieldAsynchronousDisposableResource): void;
	untrackOwnershipBinding(binding: GreenfieldAsynchronousDisposableResource): void;
	unbindExecutionRuntime(runtime: GreenfieldAsynchronousDisposableResource): void;
	unbindPluginMcpRuntime(runtime: GreenfieldAsynchronousDisposableResource): void;
	clearAuxiliarySessionIndexes(): void;
}

/** Composition 级 Session 索引与唯一资源身份登记；不负责创建或释放资源。 */
export class GreenfieldCompositionResourceRegistry implements GreenfieldCompositionResourceCleanupRegistry {
	readonly indexes: GreenfieldSessionResourceIndexes = {
		mcpControllers: new InMemoryGreenfieldSessionValueIndex<McpDeferredToolController>(),
		pluginMcpRuntimes: new InMemoryGreenfieldSessionValueIndex<CodingAgentPluginMcpRuntime>(),
		executionRuntimes: new InMemoryGreenfieldSessionValueIndex<GreenfieldSessionExecutionRuntime>(),
		configurationStates: new InMemoryGreenfieldSessionValueIndex<GreenfieldSessionConfigurationState>(),
		resourceContexts: new InMemoryGreenfieldSessionValueIndex<GreenfieldRuntimeResourceContext>(),
		extensionEventBridges: new InMemoryGreenfieldSessionValueIndex<CodingAgentGreenfieldExtensionEventBridge>(),
		memoryControllers: new InMemoryGreenfieldSessionValueIndex<CodingAgentMemoryController>(),
		hookSessionControllers: new InMemoryGreenfieldSessionValueIndex<GreenfieldSessionHookController>(),
		mcpRefreshObservedSessions: new InMemoryGreenfieldSessionMarkerIndex(),
		mcpPromptRefreshReuseSessions: new InMemoryGreenfieldSessionMarkerIndex(),
	};

	private readonly contextRuntimes = new Set<GreenfieldSynchronousDisposableResource>();
	private readonly memoryRuntimes = new Set<GreenfieldSynchronousDisposableResource>();
	private readonly hookSessionDisposers = new Set<() => Promise<void>>();
	private readonly todoRuntimes = new Set<GreenfieldAsynchronousDisposableResource>();
	private readonly turnCapabilityAssemblies = new Set<GreenfieldAsynchronousDisposableResource>();
	private readonly ownershipBindings = new Set<GreenfieldAsynchronousDisposableResource>();

	trackContextRuntime(runtime: GreenfieldSynchronousDisposableResource): void {
		this.contextRuntimes.add(runtime);
	}

	untrackContextRuntime(runtime: GreenfieldSynchronousDisposableResource): void {
		this.contextRuntimes.delete(runtime);
	}

	trackMemoryRuntime(runtime: GreenfieldSynchronousDisposableResource): void {
		this.memoryRuntimes.add(runtime);
	}

	untrackMemoryRuntime(runtime: GreenfieldSynchronousDisposableResource): void {
		this.memoryRuntimes.delete(runtime);
	}

	trackHookSessionDisposer(dispose: () => Promise<void>): void {
		this.hookSessionDisposers.add(dispose);
	}

	untrackHookSessionDisposer(dispose: () => Promise<void>): void {
		this.hookSessionDisposers.delete(dispose);
	}

	trackTodoRuntime(runtime: GreenfieldAsynchronousDisposableResource): void {
		this.todoRuntimes.add(runtime);
	}

	untrackTodoRuntime(runtime: GreenfieldAsynchronousDisposableResource): void {
		this.todoRuntimes.delete(runtime);
	}

	trackTurnCapabilityAssembly(assembly: GreenfieldAsynchronousDisposableResource): void {
		this.turnCapabilityAssemblies.add(assembly);
	}

	untrackTurnCapabilityAssembly(assembly: GreenfieldAsynchronousDisposableResource): void {
		this.turnCapabilityAssemblies.delete(assembly);
	}

	trackOwnershipBinding(binding: GreenfieldAsynchronousDisposableResource): void {
		this.ownershipBindings.add(binding);
	}

	untrackOwnershipBinding(binding: GreenfieldAsynchronousDisposableResource): void {
		this.ownershipBindings.delete(binding);
	}

	readCleanupSnapshot(): GreenfieldCompositionResourceCleanupSnapshot {
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

	unbindExecutionRuntime(runtime: GreenfieldAsynchronousDisposableResource): void {
		for (const [sessionId, registered] of this.indexes.executionRuntimes.entries()) {
			if (registered === runtime) this.indexes.executionRuntimes.delete(sessionId);
		}
	}

	unbindPluginMcpRuntime(runtime: GreenfieldAsynchronousDisposableResource): void {
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
