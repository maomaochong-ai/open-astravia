import type { UserMessage } from "@vetta/ai";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import type { CodingAgentContinuationSource } from "../runtime-contracts/index.js";
import type { TodoContinuationState } from "./contracts.js";
import { buildTodoContinuationMessages } from "./todo-continuation.js";

export type { TodoContinuationState } from "./contracts.js";

export interface CodingAgentTodoContinuationSourceOptions {
	readonly state: TodoContinuationState;
	readonly now?: () => number;
}

/**
 * Session-local Todo continuation。
 *
 * 只有锁定列表（scene 等机制写入）会在每次自然停止时继续提醒，直到全部完成；
 * 普通 Todo 不再产生续跑消息。
 */
export class CodingAgentTodoContinuationSource implements CodingAgentContinuationSource {
	private readonly now: () => number;

	constructor(private readonly options: CodingAgentTodoContinuationSourceOptions) {
		this.now = options.now ?? Date.now;
	}

	async collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]> {
		if (context.signal.aborted) return [];
		return buildTodoContinuationMessages(this.options.state, this.now);
	}
}
