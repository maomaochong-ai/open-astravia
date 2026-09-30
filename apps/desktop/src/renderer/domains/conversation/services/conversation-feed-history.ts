import { conversationItemRenderKey, type ErrorBlock } from "@shared/conversation";
import type { ChatConversationItem, ConversationFeedState } from "@shared/store/atoms";

type AgentItem = Extract<ChatConversationItem, { readonly kind: "agent" }>;

/**
 * Merge a durable snapshot by id. Durable items take their persisted order and
 * metadata; items not yet durable stay right after the item that preceded them.
 * Items that were durable before and are missing now were deleted by history.
 */
export function mergeHistorySnapshot(
	state: ConversationFeedState,
	incoming: readonly ChatConversationItem[],
	revision: number,
): ConversationFeedState {
	if (revision < state.historyRevision) return state;
	const currentById = new Map<string, ChatConversationItem>(state.items.map((item) => [item.id, item]));
	for (const user of state.queuedUsers) if (!currentById.has(user.id)) currentById.set(user.id, user);
	const incomingIds = new Set(incoming.map((item) => item.id));
	const merged = incoming.map((durable) => {
		const current = currentById.get(durable.id);
		return current ? mergeDurableItem(current, durable, state.activeTurnId) : durable;
	});

	const localsAfter = new Map<string | null, ChatConversationItem[]>();
	let anchor: string | null = null;
	for (const item of state.items) {
		if (incomingIds.has(item.id)) {
			anchor = item.id;
			continue;
		}
		if (state.durableIds.has(item.id)) continue;
		const locals = localsAfter.get(anchor) ?? [];
		locals.push(item);
		localsAfter.set(anchor, locals);
	}
	const items: ChatConversationItem[] = [];
	for (const item of merged) {
		items.push(item);
		const locals = localsAfter.get(item.id);
		if (locals) items.push(...locals);
	}
	items.push(...(localsAfter.get(null) ?? []));

	return {
		...state,
		items: sameItems(items, state.items) ? state.items : items,
		durableIds: incomingIds,
		historyRevision: revision,
		queuedUsers: state.queuedUsers.filter((user) => !incomingIds.has(user.id)),
	};
}

/**
 * Durable metadata always wins. A message of the running Turn keeps its live
 * content; a settled message takes persisted content unless the snapshot is
 * older than what is already shown.
 */
function mergeDurableItem(
	current: ChatConversationItem,
	durable: ChatConversationItem,
	activeTurnId: string | null,
): ChatConversationItem {
	if (current.kind !== durable.kind) return durable;
	let merged: ChatConversationItem;
	if (current.kind === "user" && durable.kind === "user") {
		merged = {
			...durable,
			// Editor-only snapshot fields are never persisted; keep them from the send.
			...(current.inputSegments ? { inputSegments: current.inputSegments } : {}),
			...(current.images ? { images: current.images } : {}),
			...(current.appshot ? { appshot: current.appshot } : {}),
			...(current.mentionedFiles?.length && !durable.mentionedFiles?.length
				? { mentionedFiles: current.mentionedFiles }
				: {}),
			// Records written before Turn identity default turnId to their own id; the live fact wins then.
			turnId: durable.turnId !== durable.id ? durable.turnId : current.turnId,
			attachments: durable.attachments ?? current.attachments,
			settingsAssistTabId: durable.settingsAssistTabId ?? current.settingsAssistTabId,
			promptRef: durable.promptRef ?? current.promptRef,
			model: durable.model ?? current.model,
			timestamp: durable.timestamp ?? current.timestamp,
			deliveryPhase: "completed",
		};
	} else if (current.kind === "agent" && durable.kind === "agent") {
		merged = mergeAgentItem(current, durable, current.turnId === activeTurnId);
	} else {
		merged = durable;
	}
	merged = withStableRenderKey(current, merged);
	return sameValue(merged, current) ? current : merged;
}

function mergeAgentItem(current: AgentItem, durable: AgentItem, running: boolean): AgentItem {
	const liveContentCount = current.blocks.filter((block) => block.type !== "error").length;
	if (running || durable.blocks.length < liveContentCount) {
		return {
			...current,
			entryId: durable.entryId ?? current.entryId,
			usages: current.usages ?? durable.usages,
			startedAt: current.startedAt ?? durable.startedAt,
			endedAt: current.endedAt ?? durable.endedAt,
			durationSeconds: current.durationSeconds ?? durable.durationSeconds,
		};
	}
	const currentErrors = current.blocks.filter((block): block is ErrorBlock => block.type === "error");
	// History keeps the failure but not the retry count and provider details seen live.
	const blocks = durable.blocks.map((block) => {
		if (block.type !== "error") return block;
		const live = currentErrors.find((candidate) => sameError(candidate, block));
		if (!live) return block;
		return {
			...block,
			...(block.attempts === undefined && live.attempts !== undefined ? { attempts: live.attempts } : {}),
			...(live.details ? { details: { ...live.details, ...block.details } } : {}),
		};
	});
	const liveErrors = currentErrors.filter(
		(block) => !durable.blocks.some((candidate) => candidate.type === "error" && sameError(candidate, block)),
	);
	return {
		...durable,
		...(current.toolCallPresentations ? { toolCallPresentations: current.toolCallPresentations } : {}),
		phase: current.phase,
		text: durable.text || current.text,
		blocks: liveErrors.length > 0 ? [...blocks, ...liveErrors] : blocks,
		startedAt: current.startedAt ?? durable.startedAt,
		endedAt: current.endedAt ?? durable.endedAt,
		durationSeconds: current.durationSeconds ?? durable.durationSeconds,
		modelRequestStartedAt: current.modelRequestStartedAt ?? durable.modelRequestStartedAt,
		usages: durable.usages ?? current.usages,
	};
}

function sameError(left: ErrorBlock, right: ErrorBlock): boolean {
	if (left.turnId && right.turnId) return left.turnId === right.turnId;
	return left.kind === right.kind && left.text === right.text;
}

/** Keep the DOM row when an item's identity fields change (draft adoption, durable entryId). */
export function withStableRenderKey<T extends ChatConversationItem>(previous: ChatConversationItem, next: T): T {
	const key = conversationItemRenderKey(previous);
	return conversationItemRenderKey(next) === key ? next : { ...next, renderKey: key };
}

function sameItems(left: readonly ChatConversationItem[], right: readonly ChatConversationItem[]): boolean {
	return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Structural equality of JSON-like view models; undefined fields count as absent. */
function sameValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
	for (const key of keys) if (!sameValue(leftRecord[key], rightRecord[key])) return false;
	return true;
}
