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
	/** 已经历多少次"规范历史已到达该序号却仍未确认"的对账。 */
	unresolvedReconciles?: number;
}

/**
 * 对不上账的乐观气泡最多再撑过这么多次对账。
 * 正常气泡在消息落盘后的第一次全量历史回流就会被确认；撑不过这个上限的，
 * 说明它根本不会出现在规范历史里（例如队列镜像补出的内部消息），继续留着
 * 只会每次对账都被重新追加到列表末尾，形成永久残留且位置错乱。
 */
const MAX_UNRESOLVED_RECONCILES = 3;

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
	const confirmedSnapshots = new Map<
		ConversationUserMessageViewModel,
		ConversationUserMessageViewModel["inputSegments"]
	>();
	const unresolved: PendingOptimisticUserMessage[] = [];
	for (const entry of pending) {
		const canonical = canonicalUsers[entry.precedingUserCount];
		// 规范历史还没写到这个序号：本轮消息仍在落盘途中，无条件保留。
		if (!canonical) {
			unresolved.push(entry);
			continue;
		}
		const confirmed = entry.matchTextOnly
			? sameText(canonical.text, entry.message.text)
			: sameUserMessage(canonical, entry.message);
		if (confirmed) {
			if (!entry.matchTextOnly && entry.message.inputSegments) {
				confirmedSnapshots.set(canonical, entry.message.inputSegments);
			}
			continue;
		}
		const attempts = (entry.unresolvedReconciles ?? 0) + 1;
		if (attempts > MAX_UNRESOLVED_RECONCILES) continue;
		unresolved.push({ ...entry, unresolvedReconciles: attempts });
	}

	if (unresolved.length === 0) {
		pendingByRuntimeId.delete(runtimeId);
		return applyConfirmedInputSnapshots(history, confirmedSnapshots);
	}
	pendingByRuntimeId.set(runtimeId, unresolved);

	const historyIds = new Set(history.map((message) => message.id));
	return [
		...applyConfirmedInputSnapshots(history, confirmedSnapshots),
		...unresolved.map(({ message }) => message).filter((message) => !historyIds.has(message.id)),
	];
}

function applyConfirmedInputSnapshots(
	history: readonly ChatConversationItem[],
	snapshots: ReadonlyMap<ConversationUserMessageViewModel, ConversationUserMessageViewModel["inputSegments"]>,
): ChatConversationItem[] {
	if (snapshots.size === 0) return [...history];
	return history.map((message) => {
		if (message.kind !== "user") return message;
		const inputSegments = snapshots.get(message);
		return inputSegments ? { ...message, inputSegments } : message;
	});
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
