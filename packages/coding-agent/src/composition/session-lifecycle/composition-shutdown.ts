import { RetryableCleanup } from "@vetta/runtime-core";
import type { CodingAgentCompositionResourceRegistry } from "./resource-registry.js";

export interface CodingAgentCompositionShutdownOptions {
	readonly registry: CodingAgentCompositionResourceRegistry;
	readonly clearConversationContextOverlay: () => void;
	readonly closeConversationRepository: () => Promise<void> | void;
	readonly disposeMcpSynchronizer?: () => Promise<void> | void;
	readonly disposeCodingTools: () => Promise<void> | void;
	/** 必须先关闭 Session Backend；失败时不得继续释放仍被 Session 使用的共享资源。 */
	readonly closeAgentRuntime?: () => Promise<void> | void;
	/** 必须最后关闭，使其它资源释放阶段仍可发布最终诊断。 */
	readonly closeObservationHub?: () => Promise<void> | void;
}

export interface CodingAgentCompositionShutdown {
	dispose(): Promise<void>;
}

/** Composition 关闭事务。Session Plan 是产品 Session 资源的唯一 owner。 */
export function createCodingAgentCompositionShutdown(
	options: CodingAgentCompositionShutdownOptions,
): CodingAgentCompositionShutdown {
	let sessionsClosed = options.closeAgentRuntime === undefined;
	const sharedCleanup = new RetryableCleanup();
	sharedCleanup.add({
		id: "session-indexes",
		phase: 0,
		cleanup: () => {
			options.registry.clear();
			options.clearConversationContextOverlay();
		},
	});
	sharedCleanup.add({ id: "conversation-repository", phase: 1, cleanup: options.closeConversationRepository });
	if (options.disposeMcpSynchronizer) {
		sharedCleanup.add({ id: "mcp-synchronizer", phase: 2, cleanup: options.disposeMcpSynchronizer });
	}
	sharedCleanup.add({ id: "coding-tools", phase: 2, cleanup: options.disposeCodingTools });
	if (options.closeObservationHub) {
		sharedCleanup.add({ id: "observation-hub", phase: 3, cleanup: options.closeObservationHub });
	}

	return {
		async dispose() {
			if (!sessionsClosed) {
				await options.closeAgentRuntime?.();
				sessionsClosed = true;
			}
			await sharedCleanup.run("Failed to dispose one or more Coding Agent Composition resources");
		},
	};
}
