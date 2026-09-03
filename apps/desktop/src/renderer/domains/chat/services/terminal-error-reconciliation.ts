import { createConversationAgentMessage, type ErrorBlock } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";

function sameTerminalError(left: ErrorBlock, right: ErrorBlock): boolean {
	if (left.turnId && right.turnId) return left.turnId === right.turnId;
	if (left.id === right.id) return true;
	return left.kind === right.kind && left.text === right.text;
}

function cloneErrorBlock(block: ErrorBlock): ErrorBlock {
	return {
		...block,
		...(block.details ? { details: { ...block.details } } : {}),
	};
}

/**
 * Preserve a live terminal error when an agent_end history read races the
 * durable history projection. Canonical history remains authoritative for all
 * other content; only the latest live assistant's error blocks are reconciled.
 */
export function reconcileHistoryWithLiveTerminalErrors(
	history: ChatConversationItem[],
	liveMessages: readonly ChatConversationItem[],
): ChatConversationItem[] {
	const liveAssistant = liveMessages.at(-1);
	if (liveAssistant?.kind !== "agent") return history;
	const liveErrors = liveAssistant.blocks.filter((block): block is ErrorBlock => block.type === "error");
	if (liveErrors.length === 0) return history;

	const lastHistoryMessage = history.at(-1);
	if (lastHistoryMessage?.kind !== "agent") {
		return [
			...history,
			createConversationAgentMessage({
				id: liveAssistant.id,
				text: liveAssistant.text || liveErrors[0]?.text || "",
				blocks: liveErrors.map(cloneErrorBlock),
				phase: "failed",
				...(liveAssistant.timestamp === undefined ? {} : { timestamp: liveAssistant.timestamp }),
				...(liveAssistant.startedAt === undefined ? {} : { startedAt: liveAssistant.startedAt }),
				...(liveAssistant.endedAt === undefined ? {} : { endedAt: liveAssistant.endedAt }),
				...(liveAssistant.durationSeconds === undefined ? {} : { durationSeconds: liveAssistant.durationSeconds }),
			}),
		];
	}

	const blocks = [...lastHistoryMessage.blocks];
	for (const liveError of liveErrors) {
		const existingIndex = blocks.findIndex((block) => block.type === "error" && sameTerminalError(block, liveError));
		if (existingIndex < 0) {
			blocks.push(cloneErrorBlock(liveError));
			continue;
		}

		const existing = blocks[existingIndex];
		if (existing.type !== "error") continue;
		blocks[existingIndex] = {
			...existing,
			text: liveError.text,
			kind: liveError.kind,
			...(liveError.turnId ? { turnId: liveError.turnId } : {}),
			...(liveError.attempts ? { attempts: liveError.attempts } : {}),
			...(liveError.details ? { details: { ...existing.details, ...liveError.details } } : {}),
		};
	}

	const next = [...history];
	next[next.length - 1] = {
		...lastHistoryMessage,
		text: lastHistoryMessage.text || liveAssistant.text || liveErrors[0]?.text || "",
		blocks,
	};
	return next;
}
