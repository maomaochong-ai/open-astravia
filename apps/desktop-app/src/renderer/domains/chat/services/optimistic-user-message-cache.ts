import type { ChatMessage } from "@shared/store/atoms";

interface PendingOptimisticUserMessage {
	message: ChatMessage;
	precedingUserCount: number;
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
	message: ChatMessage,
	currentMessages: readonly ChatMessage[],
): void {
	const pending = pendingByRuntimeId.get(runtimeId) ?? [];
	pendingByRuntimeId.set(runtimeId, [
		...pending,
		{
			message,
			precedingUserCount: currentMessages.filter((item) => item.role === "user").length,
		},
	]);
}

/**
 * Reconcile a freshly loaded canonical history with optimistic user bubbles.
 * Text is checked at the recorded ordinal so an identical older prompt cannot
 * accidentally acknowledge a newer pending send.
 */
export function reconcileOptimisticUserMessages(runtimeId: string, history: readonly ChatMessage[]): ChatMessage[] {
	const pending = pendingByRuntimeId.get(runtimeId);
	if (!pending?.length) return [...history];

	const canonicalUsers = history.filter((message) => message.role === "user");
	const unresolved = pending.filter(({ message, precedingUserCount }) => {
		const canonical = canonicalUsers[precedingUserCount];
		return !canonical || !sameUserMessage(canonical, message);
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

function sameUserMessage(canonical: ChatMessage, optimistic: ChatMessage): boolean {
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

function samePromptRef(a: ChatMessage["promptRef"], b: ChatMessage["promptRef"]): boolean {
	if (!a || !b) return a === b;
	return a.kind === b.kind && a.name === b.name;
}

function sameAttachments(a: ChatMessage["attachments"], b: ChatMessage["attachments"]): boolean {
	const left = a ?? [];
	const right = b ?? [];
	return (
		left.length === right.length &&
		left.every((item, index) => item.kind === right[index]?.kind && item.path === right[index]?.path)
	);
}
