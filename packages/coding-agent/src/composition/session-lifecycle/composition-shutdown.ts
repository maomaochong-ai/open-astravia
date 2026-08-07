import { RetryableCleanup } from "@vetta/runtime-core";
import type {
	CodingAgentAsynchronousDisposableResource,
	CodingAgentCompositionResourceCleanupRegistry,
	CodingAgentCompositionResourceCleanupSnapshot,
	CodingAgentSynchronousDisposableResource,
} from "./resource-registry.js";

export interface CodingAgentCompositionShutdownOptions {
	readonly registry: CodingAgentCompositionResourceCleanupRegistry;
	readonly clearConversationContextOverlay: () => void;
	readonly closeConversationRepository: () => Promise<void> | void;
	readonly disposeMcpSynchronizer?: () => Promise<void> | void;
	readonly disposeCodingTools: () => Promise<void> | void;
}

export interface CodingAgentCompositionShutdown {
	dispose(): Promise<void>;
}

/** Composition 级关闭事务；第一次关闭冻结资源集合，失败项由后续调用继续重试。 */
export function createCodingAgentCompositionShutdown(
	options: CodingAgentCompositionShutdownOptions,
): CodingAgentCompositionShutdown {
	const cleanup = new RetryableCleanup();
	let prepared = false;

	return {
		async dispose() {
			if (!prepared) {
				prepared = true;
				prepareCleanup(cleanup, options, options.registry.readCleanupSnapshot());
			}
			try {
				await cleanup.run("Failed to dispose one or more runtime resources");
			} catch (error) {
				throw new AggregateError(
					error instanceof AggregateError ? error.errors : [error],
					"Failed to dispose one or more runtime resources",
				);
			}
		},
	};
}

function prepareCleanup(
	cleanup: RetryableCleanup,
	options: CodingAgentCompositionShutdownOptions,
	resources: CodingAgentCompositionResourceCleanupSnapshot,
): void {
	addSynchronousResources(cleanup, "context-runtime", resources.contextRuntimes, (runtime) =>
		options.registry.untrackContextRuntime(runtime),
	);
	addSynchronousResources(cleanup, "memory-runtime", resources.memoryRuntimes, (runtime) =>
		options.registry.untrackMemoryRuntime(runtime),
	);
	addAsynchronousResources(cleanup, "execution-runtime", resources.executionRuntimes, (runtime) =>
		options.registry.unbindExecutionRuntime(runtime),
	);
	for (const [index, disposeHookSession] of resources.hookSessionDisposers.entries()) {
		cleanup.add({
			id: `hook-session:${index}`,
			phase: 0,
			cleanup: async () => {
				await disposeHookSession();
				options.registry.untrackHookSessionDisposer(disposeHookSession);
			},
		});
	}
	addAsynchronousResources(cleanup, "todo-runtime", resources.todoRuntimes, (runtime) =>
		options.registry.untrackTodoRuntime(runtime),
	);
	addAsynchronousResources(cleanup, "capability-composition", resources.turnCapabilityAssemblies, (assembly) =>
		options.registry.untrackTurnCapabilityAssembly(assembly),
	);
	addAsynchronousResources(cleanup, "ownership-binding", resources.ownershipBindings, (binding) =>
		options.registry.untrackOwnershipBinding(binding),
	);
	addAsynchronousResources(cleanup, "plugin-mcp-runtime", resources.pluginMcpRuntimes, (runtime) =>
		options.registry.unbindPluginMcpRuntime(runtime),
	);
	cleanup.add({
		id: "session-registries",
		phase: 1,
		cleanup: () => {
			options.registry.clearAuxiliarySessionIndexes();
			options.clearConversationContextOverlay();
		},
	});
	cleanup.add({ id: "conversation-repository", phase: 2, cleanup: options.closeConversationRepository });
	if (options.disposeMcpSynchronizer) {
		cleanup.add({ id: "mcp-synchronizer", phase: 3, cleanup: options.disposeMcpSynchronizer });
	}
	cleanup.add({ id: "coding-tools", phase: 3, cleanup: options.disposeCodingTools });
}

function addSynchronousResources(
	cleanup: RetryableCleanup,
	idPrefix: string,
	resources: readonly CodingAgentSynchronousDisposableResource[],
	untrack: (resource: CodingAgentSynchronousDisposableResource) => void,
): void {
	for (const [index, resource] of resources.entries()) {
		cleanup.add({
			id: `${idPrefix}:${index}`,
			phase: 0,
			cleanup: () => {
				resource.dispose();
				untrack(resource);
			},
		});
	}
}

function addAsynchronousResources(
	cleanup: RetryableCleanup,
	idPrefix: string,
	resources: readonly CodingAgentAsynchronousDisposableResource[],
	untrack: (resource: CodingAgentAsynchronousDisposableResource) => void,
): void {
	for (const [index, resource] of resources.entries()) {
		cleanup.add({
			id: `${idPrefix}:${index}`,
			phase: 0,
			cleanup: async () => {
				await resource.dispose();
				untrack(resource);
			},
		});
	}
}
