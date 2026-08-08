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
 * Session-local Todo continuation 状态机。
 *
 * 普通 Todo 的“同一待办集合只提醒一次”状态按外部 Turn 隔离；锁定列表仍会在每次
 * 自然停止时持续提醒，直到全部完成。
 */
export class CodingAgentTodoContinuationSource implements CodingAgentContinuationSource {
	private lastTurnId: string | undefined;
	private lastNudgeSignature: string | undefined;
	private readonly now: () => number;

	constructor(private readonly options: CodingAgentTodoContinuationSourceOptions) {
		this.now = options.now ?? Date.now;
	}

	async collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]> {
		if (context.signal.aborted) return [];
		if (this.lastTurnId !== context.turnId) {
			this.lastTurnId = context.turnId;
			this.lastNudgeSignature = undefined;
		}
		const result = buildTodoContinuationMessages(this.options.state, this.lastNudgeSignature, this.now);
		this.lastNudgeSignature = result.nextNudgeSignature;
		return result.messages;
	}
}
