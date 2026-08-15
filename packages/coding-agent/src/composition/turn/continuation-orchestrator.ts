import type { ContinuationMessage, ContinuationPolicy, ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import type { SessionExtensionContinuationSource } from "@vetta/runtime-core/session-extensions";

export type { CodingAgentContinuationSource } from "../../runtime-contracts/index.js";

export interface CodingAgentContinuationOrchestratorOptions {
	readonly sources: readonly SessionExtensionContinuationSource[];
}

/**
 * Coding Agent 产品级自然停止编排器。
 *
 * 用户 follow-up 的优先级由 Runtime Core 的既有队列保证；进入本策略后严格按
 * Todo -> Plugin -> Stop Hook 选择第一个产生消息的来源。
 */
export class CodingAgentContinuationOrchestrator implements ContinuationPolicy {
	private readonly sources: readonly SessionExtensionContinuationSource[];

	constructor(options: CodingAgentContinuationOrchestratorOptions) {
		const byId = new Set<string>();
		for (const source of options.sources) {
			if (byId.has(source.id)) throw new Error(`Duplicate continuation source id: ${source.id}`);
			byId.add(source.id);
		}
		this.sources = [...options.sources].sort(
			(left, right) => left.priority - right.priority || left.id.localeCompare(right.id),
		);
	}

	async collect(context: ContinuationPolicyContext): Promise<readonly ContinuationMessage[]> {
		if (context.signal.aborted) return [];
		for (const source of this.sources) {
			const messages = await source.collect(context);
			if (messages.length > 0) return messages.map((message) => ({ message, source: source.id }));
			if (context.signal.aborted) return [];
		}
		return [];
	}
}
