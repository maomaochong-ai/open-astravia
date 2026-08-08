import type { UserMessage } from "@vetta/ai";
import type { ContinuationPolicy, ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import type { CodingAgentContinuationSource } from "../../runtime-contracts/index.js";

export type { CodingAgentContinuationSource } from "../../runtime-contracts/index.js";

export interface CodingAgentContinuationOrchestratorOptions {
	readonly todo?: CodingAgentContinuationSource;
	readonly plugin?: CodingAgentContinuationSource;
	readonly stopHook?: CodingAgentContinuationSource;
}

/**
 * Coding Agent 产品级自然停止编排器。
 *
 * 用户 follow-up 的优先级由 Runtime Core 的既有队列保证；进入本策略后严格按
 * Todo -> Plugin -> Stop Hook 选择第一个产生消息的来源。
 */
export class CodingAgentContinuationOrchestrator implements ContinuationPolicy {
	constructor(private readonly options: CodingAgentContinuationOrchestratorOptions) {}

	async collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]> {
		if (context.signal.aborted) return [];
		for (const source of [this.options.todo, this.options.plugin, this.options.stopHook]) {
			if (!source) continue;
			const messages = await source.collect(context);
			if (messages.length > 0) return messages;
			if (context.signal.aborted) return [];
		}
		return [];
	}
}
