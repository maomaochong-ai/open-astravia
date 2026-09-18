import type { ChatConversationItem } from "@shared/store/atoms";
import { reconcileHistoryWithLiveTerminalErrors } from "./terminal-error-reconciliation";

function sameBranch(
	left: Extract<ChatConversationItem, { kind: "user" }>["branch"],
	right: Extract<ChatConversationItem, { kind: "user" }>["branch"],
): boolean {
	if (left === right) return true;
	if (!left || !right) return !left && !right;
	return (
		left.index === right.index &&
		left.siblings.length === right.siblings.length &&
		left.siblings.every((sibling, index) => sibling === right.siblings[index])
	);
}

function withStableRenderKey<T extends ChatConversationItem>(item: T): T {
	if (item.renderKey) return item;
	return { ...item, renderKey: item.id };
}

/**
 * Copy durable identity onto the live timeline without replacing assistant
 * blocks. Returns null when the shapes diverge so the caller can fall back
 * to a full canonical replace.
 */
export function patchLiveMessagesWithCanonical(
	live: readonly ChatConversationItem[],
	canonical: readonly ChatConversationItem[],
): ChatConversationItem[] | null {
	if (live.length !== canonical.length) return null;
	const next: ChatConversationItem[] = [];
	for (let index = 0; index < live.length; index++) {
		const liveItem = live[index];
		const canonicalItem = canonical[index];
		if (!liveItem || !canonicalItem || liveItem.kind !== canonicalItem.kind) return null;

		if (liveItem.kind === "event") {
			if (canonicalItem.kind !== "event" || liveItem.event.kind !== canonicalItem.event.kind) return null;
			if (liveItem.entryId === canonicalItem.entryId) {
				next.push(liveItem);
				continue;
			}
			next.push(withStableRenderKey({ ...liveItem, entryId: canonicalItem.entryId ?? liveItem.entryId }));
			continue;
		}

		if (liveItem.kind === "user") {
			if (canonicalItem.kind !== "user") return null;
			const entryId = canonicalItem.entryId ?? liveItem.entryId;
			const parentId = canonicalItem.parentId ?? liveItem.parentId;
			const branch = canonicalItem.branch ?? liveItem.branch;
			if (
				liveItem.entryId === entryId &&
				liveItem.parentId === parentId &&
				sameBranch(liveItem.branch, branch) &&
				liveItem.deliveryPhase === "completed"
			) {
				next.push(liveItem);
				continue;
			}
			next.push(
				withStableRenderKey({
					...liveItem,
					entryId,
					parentId,
					branch,
					deliveryPhase: "completed",
				}),
			);
			continue;
		}

		if (canonicalItem.kind !== "agent") return null;
		const entryId = canonicalItem.entryId ?? liveItem.entryId;
		const startedAt = liveItem.startedAt ?? canonicalItem.startedAt;
		const endedAt = liveItem.endedAt ?? canonicalItem.endedAt;
		const durationSeconds = liveItem.durationSeconds ?? canonicalItem.durationSeconds;
		const usages = liveItem.usages ?? canonicalItem.usages;
		if (
			liveItem.entryId === entryId &&
			liveItem.startedAt === startedAt &&
			liveItem.endedAt === endedAt &&
			liveItem.durationSeconds === durationSeconds &&
			liveItem.usages === usages
		) {
			next.push(liveItem);
			continue;
		}
		next.push(
			withStableRenderKey({
				...liveItem,
				entryId,
				startedAt,
				endedAt,
				durationSeconds,
				usages,
			}),
		);
	}
	return next;
}

export function applyAgentEndHistoryRefresh(
	live: readonly ChatConversationItem[],
	canonical: ChatConversationItem[],
): ChatConversationItem[] {
	return patchLiveMessagesWithCanonical(live, canonical) ?? reconcileHistoryWithLiveTerminalErrors(canonical, live);
}
