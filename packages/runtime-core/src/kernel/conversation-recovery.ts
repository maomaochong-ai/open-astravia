import type { StoredConversation } from "./contracts.js";
import { turnProtocolError } from "./errors.js";

export type ConversationRecoveryPlan =
	| { readonly status: "ready" }
	| { readonly status: "interrupt"; readonly turnId: string };

/** 决定已有 Conversation 在重新暴露为可执行 Session 前应如何收敛。 */
export interface ConversationRecoveryPolicy {
	plan(conversation: StoredConversation): ConversationRecoveryPlan;
}

/**
 * 将唯一未闭合 Turn 标记为中断；不重放模型、工具或进程内输入队列。
 * 非法生命周期拒绝恢复，避免在损坏历史上继续追加事件。
 *
 * 唯一豁免是「终态之后的同 Turn 残留」：该 Turn 已经收敛，之后仍出现它自己的
 * message/context/重复终态，说明有两个写入者同时追加同一个会话文件（进程级所有权
 * 缺失时的已知故障）。这类残留不会再改变会话可执行性，因此按残留忽略而不是判死
 * 整条会话；没有 Turn 的事件、跨 Turn 交错仍然拒绝。
 */
export class FailInterruptedTurnRecoveryPolicy implements ConversationRecoveryPolicy {
	plan(conversation: StoredConversation): ConversationRecoveryPlan {
		let activeTurnId: string | undefined;
		const terminatedTurnIds = new Set<string>();

		for (const event of conversation.events) {
			if (event.sessionId !== conversation.sessionId) {
				throw turnProtocolError(
					`Conversation ${conversation.sessionId} contains an event for session ${event.sessionId}`,
				);
			}

			switch (event.type) {
				case "turn.started":
				case "turn.continued":
					if (activeTurnId) {
						throw turnProtocolError(
							`Conversation ${conversation.sessionId} starts turn ${event.turnId} before turn ${activeTurnId} terminates`,
						);
					}
					activeTurnId = event.turnId;
					break;
				case "message.appended":
				case "context.appended":
					if (isPostTerminalResidue(activeTurnId, event.turnId, terminatedTurnIds)) break;
					assertActiveTurn(conversation.sessionId, activeTurnId, event.turnId, event.type);
					break;
				case "context.recorded":
					if (activeTurnId) {
						throw turnProtocolError(
							`Conversation ${conversation.sessionId} records session context inside turn ${activeTurnId}`,
						);
					}
					break;
				case "context.compacted":
					if ("reason" in event.record && event.record.reason === "manual") {
						if (activeTurnId || event.turnId !== undefined) {
							throw turnProtocolError(
								`Conversation ${conversation.sessionId} contains manual compaction inside turn ${activeTurnId ?? event.turnId}`,
							);
						}
						break;
					}
					if (!event.turnId) {
						const reason = "reason" in event.record ? event.record.reason : "legacy";
						throw turnProtocolError(
							`Conversation ${conversation.sessionId} contains ${reason} compaction without a turn`,
						);
					}
					if (isPostTerminalResidue(activeTurnId, event.turnId, terminatedTurnIds)) break;
					assertActiveTurn(conversation.sessionId, activeTurnId, event.turnId, event.type);
					break;
				case "turn.completed":
				case "turn.cancelled":
				case "turn.failed":
				case "turn.transferred":
					// 同一 Turn 的重复终态同样按残留忽略：两个写入者各自收尾时都会写一条。
					if (isPostTerminalResidue(activeTurnId, event.turnId, terminatedTurnIds)) break;
					assertActiveTurn(conversation.sessionId, activeTurnId, event.turnId, event.type);
					terminatedTurnIds.add(event.turnId);
					activeTurnId = undefined;
					break;
			}
		}

		return activeTurnId ? { status: "interrupt", turnId: activeTurnId } : { status: "ready" };
	}
}

function isPostTerminalResidue(
	activeTurnId: string | undefined,
	eventTurnId: string,
	terminatedTurnIds: ReadonlySet<string>,
): boolean {
	// 该 Turn 已收敛、当前也没有它自己在跑：同类后续事件都是残留，不再改变可执行性。
	return activeTurnId !== eventTurnId && terminatedTurnIds.has(eventTurnId);
}

function assertActiveTurn(
	sessionId: string,
	activeTurnId: string | undefined,
	eventTurnId: string,
	eventType: string,
): asserts activeTurnId is string {
	if (!activeTurnId) {
		throw turnProtocolError(
			`Conversation ${sessionId} contains ${eventType} for turn ${eventTurnId} without an active turn`,
		);
	}
	if (activeTurnId !== eventTurnId) {
		throw turnProtocolError(
			`Conversation ${sessionId} contains ${eventType} for turn ${eventTurnId} while turn ${activeTurnId} is active`,
		);
	}
}
