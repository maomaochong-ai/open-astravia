import type { ConversationUserMessageViewModel } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";

interface PendingOptimisticUserMessage {
	message: ConversationUserMessageViewModel;
	precedingUserCount: number;
	/**
	 * 队列镜像补的气泡只有 displayText，没有规范消息才有的 attachments /
	 * promptRef 元数据；这类气泡只按文本 + 序号吸收（ADR-0060）。
	 */
	matchTextOnly?: boolean;
}

const pendingByRuntimeId = new Map<string, PendingOptimisticUserMessage[]>();

/**
 * Keep a user bubble until the canonical history confirms the corresponding
 * user-message ordinal. Session switching clears the active message atom, so
 * this cache bridges the short window between optimistic rendering and the
 * runtime persisting the turn-start events.
 */
export function rememberOptimisticUserMessage(
	runtimeId: string,
	message: ConversationUserMessageViewModel,
	currentMessages: readonly ChatConversationItem[],
	options?: { matchTextOnly?: boolean },
): void {
	const pending = pendingByRuntimeId.get(runtimeId) ?? [];
	pendingByRuntimeId.set(runtimeId, [
		...pending,
		{
			message,
			precedingUserCount: currentMessages.filter((item) => item.kind === "user").length,
			...(options?.matchTextOnly ? { matchTextOnly: true } : {}),
		},
	]);
}

/**
 * Reconcile a freshly loaded canonical history with optimistic user bubbles.
 * Text is checked at the recorded ordinal so an identical older prompt cannot
 * accidentally acknowledge a newer pending send.
 */
export function reconcileOptimisticUserMessages(
	runtimeId: string,
	history: readonly ChatConversationItem[],
): ChatConversationItem[] {
	const pending = pendingByRuntimeId.get(runtimeId);
	if (!pending?.length) return [...history];

	const canonicalUsers = history.filter(
		(message): message is ConversationUserMessageViewModel => message.kind === "user",
	);
	const unresolved = pending.filter(({ message, precedingUserCount, matchTextOnly }) => {
		const canonical = canonicalUsers[precedingUserCount];
		if (!canonical) return true;
		return matchTextOnly ? !sameText(canonical.text, message.text) : !sameUserMessage(canonical, message);
	});

	if (unresolved.length === 0) {
		pendingByRuntimeId.delete(runtimeId);
		return [...history];
	}
	pendingByRuntimeId.set(runtimeId, unresolved);

	const historyIds = new Set(history.map((message) => message.id));
	return [...history, ...unresolved.map(({ message }) => message).filter((message) => !historyIds.has(message.id))];
}

export function clearOptimisticUserMessages(runtimeId?: string): void {
	if (runtimeId) {
		pendingByRuntimeId.delete(runtimeId);
		return;
	}
	pendingByRuntimeId.clear();
}

function sameUserMessage(
	canonical: ConversationUserMessageViewModel,
	optimistic: ConversationUserMessageViewModel,
): boolean {
	return (
		sameText(canonical.text, optimistic.text) &&
		canonical.settingsAssistTabId === optimistic.settingsAssistTabId &&
		samePromptRef(canonical.promptRef, optimistic.promptRef) &&
		sameAttachments(canonical.attachments, optimistic.attachments)
	);
}

function sameText(canonical: string, optimistic: string): boolean {
	return canonical === optimistic || (optimistic === "" && canonical === "(see attached content)");
}

function samePromptRef(
	a: ConversationUserMessageViewModel["promptRef"],
	b: ConversationUserMessageViewModel["promptRef"],
): boolean {
	if (!a || !b) return a === b;
	return a.kind === b.kind && a.name === b.name;
}

function sameAttachments(
	a: ConversationUserMessageViewModel["attachments"],
	b: ConversationUserMessageViewModel["attachments"],
): boolean {
	const left = a ?? [];
	const right = b ?? [];
	return (
		left.length === right.length &&
		left.every((item, index) => item.kind === right[index]?.kind && item.path === right[index]?.path)
	);
}
