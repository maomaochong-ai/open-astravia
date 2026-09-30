import {
	abortConversationAgentMessage,
	type ConversationUserMessageViewModel,
	conversationItemRenderKey,
	createConversationAgentMessage,
	createConversationUserMessage,
	type ErrorBlock,
	reduceConversationMessageEvent,
} from "@shared/conversation";
import type { ChatConversationItem, ChatErrorDetails, ConversationFeedState } from "@shared/store/atoms";
import type { AssistantSessionEvent, SessionEvent } from "@vetta/runtime-core";
import { findToolCallMessageIndex, withToolCallEnded, withToolCallPhase, withToolCallStarted } from "./chat-service";
import { classifyChatError } from "./classifyChatError";
import { conversationAssistantMessageId } from "./conversation-message-identity";

type AgentItem = Extract<ChatConversationItem, { readonly kind: "agent" }>;
type UserItem = Extract<ChatConversationItem, { readonly kind: "user" }>;

/** Renderer-local ids: drafts created before a Turn exists and errors that never reach the Runtime. */
const LOCAL_ITEM_PREFIX = "local:";
const FEED_CONVERSATION_ID = "conversation-feed";

/** Actions that only apply to the feed of the Runtime that produced them carry `runtimeId`. */
interface RuntimeScoped {
	readonly runtimeId?: string;
}

export type ConversationFeedAction =
	/** Replace every item, e.g. after a destructive history edit. All items become durable. */
	| { readonly type: "feed.replaced"; readonly items: readonly ChatConversationItem[] }
	/** Bind an unbound feed to its Runtime and restore that Runtime's unconfirmed sends. */
	| { readonly type: "feed.bound"; readonly runtimeId: string; readonly outbox?: ConversationFeedOutbox }
	/** A durable history snapshot. Merged by id; never removes items that are not yet durable. */
	| (RuntimeScoped & {
			readonly type: "history.loaded";
			readonly items: readonly ChatConversationItem[];
			readonly revision: number;
	  })
	| (RuntimeScoped & { readonly type: "runtime.events"; readonly events: readonly SessionEvent[] })
	/** The user sent a first prompt before the Runtime could start its Turn. */
	| { readonly type: "turn.pending"; readonly startedAt: number }
	/** A subscriber joined while `turnId` was already running. */
	| (RuntimeScoped & { readonly type: "turn.restored"; readonly turnId?: string; readonly startedAt: number })
	| (RuntimeScoped & { readonly type: "user.sent"; readonly message: ConversationUserMessageViewModel })
	| (RuntimeScoped & { readonly type: "user.queued"; readonly message: ConversationUserMessageViewModel })
	/** The Runtime queued a send that was shown optimistically; it reappears when appended. */
	| (RuntimeScoped & { readonly type: "user.deferred"; readonly id: string })
	| (RuntimeScoped & { readonly type: "user.failed"; readonly id: string })
	| (RuntimeScoped & { readonly type: "user.discarded"; readonly id: string })
	| (RuntimeScoped & {
			readonly type: "user.updated";
			readonly id: string;
			readonly patch: Partial<ConversationUserMessageViewModel>;
	  })
	| (RuntimeScoped & {
			readonly type: "error.appended";
			readonly message: string;
			readonly timestamp: number;
			readonly attempts?: number;
			readonly turnId?: string;
			readonly details?: ChatErrorDetails;
	  })
	/** Remove `fromId` and everything after it (failed-resend rollback). */
	| (RuntimeScoped & { readonly type: "items.truncated"; readonly fromId: string });

/** Sends that the Runtime has not confirmed yet; they survive switching away from the feed. */
export interface ConversationFeedOutbox {
	readonly visible: readonly ConversationUserMessageViewModel[];
	readonly queued: readonly ConversationUserMessageViewModel[];
}

export function reduceConversationFeed(
	state: ConversationFeedState,
	action: ConversationFeedAction,
): ConversationFeedState {
	if ("runtimeId" in action && action.type !== "feed.bound" && action.runtimeId !== undefined) {
		if (state.runtimeId !== action.runtimeId) return state;
	}
	switch (action.type) {
		case "feed.replaced":
			return { ...state, items: action.items, durableIds: new Set(action.items.map((item) => item.id)) };
		case "feed.bound":
			return bindFeed(state, action.runtimeId, action.outbox);
		case "history.loaded":
			return mergeHistory(state, action.items, action.revision);
		case "runtime.events": {
			let next = state;
			for (const event of action.events) next = applyRuntimeEvent(next, event);
			return next;
		}
		case "turn.pending":
			return startPendingTurn(state, action.startedAt);
		case "turn.restored":
			return restoreTurn(state, action.turnId, action.startedAt);
		case "user.sent":
			return withItems(state, upsertItem(state.items, action.message));
		case "user.queued":
			return {
				...state,
				queuedUsers: [...state.queuedUsers.filter((user) => user.id !== action.message.id), action.message],
			};
		case "user.deferred": {
			const index = state.items.findIndex((item) => item.id === action.id && item.kind === "user");
			const item = state.items[index];
			if (item?.kind !== "user" || state.durableIds.has(item.id)) return state;
			return {
				...state,
				items: removeAt(state.items, index),
				queuedUsers: [...state.queuedUsers.filter((user) => user.id !== item.id), item],
			};
		}
		case "user.failed":
			return updateUser(state, action.id, { deliveryPhase: "failed" });
		case "user.discarded": {
			const index = state.items.findIndex((item) => item.id === action.id);
			const items = index >= 0 && !state.durableIds.has(action.id) ? removeAt(state.items, index) : state.items;
			const queuedUsers = state.queuedUsers.filter((user) => user.id !== action.id);
			if (items === state.items && queuedUsers.length === state.queuedUsers.length) return state;
			return { ...state, items, queuedUsers };
		}
		case "user.updated":
			return updateUser(state, action.id, action.patch);
		case "error.appended":
			return appendFeedError(state, action);
		case "items.truncated": {
			const index = state.items.findIndex((item) => item.id === action.fromId);
			if (index < 0) return state;
			const items = state.items.slice(0, index);
			const kept = new Set(items.map((item) => item.id));
			return { ...state, items, durableIds: new Set([...state.durableIds].filter((id) => kept.has(id))) };
		}
	}
}

/** Unconfirmed sends of this feed, to be restored when its Runtime is shown again. */
export function conversationFeedOutbox(state: ConversationFeedState): ConversationFeedOutbox {
	return {
		visible: state.items.filter(
			(item): item is UserItem =>
				item.kind === "user" && item.deliveryPhase === "pending" && !state.durableIds.has(item.id),
		),
		queued: state.queuedUsers,
	};
}

/** Start time of the assistant message that currently owns the tail of the feed. */
export function activeAssistantStartedAt(items: readonly ChatConversationItem[]): number | undefined {
	const last = items.at(-1);
	return last?.kind === "agent" && last.endedAt === undefined ? last.startedAt : undefined;
}

// ─── Runtime events ───

function applyRuntimeEvent(state: ConversationFeedState, event: SessionEvent): ConversationFeedState {
	if (event.sequence !== undefined) {
		// A subscriber may receive a buffered event again; each sequence applies once.
		if (event.sequence <= state.sequence) return state;
		state = { ...state, sequence: event.sequence };
	}
	if (event.channel === "assistant") return applyAssistantEvent(state, event);
	switch (event.type) {
		case "conversation.turn.started": {
			const resolved = resolveTurnAssistant(state, event.turnId, event.timestamp);
			const item = resolved.items[resolved.index] as AgentItem;
			const active =
				item.phase === "streaming" && item.endedAt === undefined && item.startedAt !== undefined
					? item
					: {
							...item,
							phase: "streaming" as const,
							startedAt: item.startedAt ?? event.timestamp,
							timestamp: item.timestamp ?? event.timestamp,
							endedAt: undefined,
							durationSeconds: undefined,
						};
			return {
				...resolved.state,
				items: replaceAt(resolved.items, resolved.index, active),
				activeTurnId: event.turnId,
			};
		}
		case "conversation.message.appended":
			return event.message.role === "user" ? commitUserMessage(state, event) : state;
		case "model.request.started": {
			const resolved = resolveTurnAssistant(state, event.turnId, event.timestamp);
			const item = resolved.items[resolved.index] as AgentItem;
			if (item.modelRequestStartedAt !== undefined) return withItems(resolved.state, resolved.items);
			return withItems(
				resolved.state,
				replaceAt(resolved.items, resolved.index, { ...item, modelRequestStartedAt: event.timestamp }),
			);
		}
		case "conversation.turn.completed":
		case "conversation.turn.cancelled":
		case "conversation.turn.failed":
			return finishTurn(state, event);
		case "tool.start": {
			let index = findToolCallMessageIndex(state.items, event.toolCallId);
			let next = state;
			if (index < 0) {
				if (state.activeTurnId) {
					const resolved = resolveTurnAssistant(state, state.activeTurnId, event.timestamp);
					next = withItems(resolved.state, resolved.items);
					index = resolved.index;
				} else if (state.items.at(-1)?.kind === "agent") {
					index = state.items.length - 1;
				} else {
					return state;
				}
			}
			const item = next.items[index] as AgentItem;
			const args = (event.args as Record<string, unknown> | undefined) ?? {};
			return withItems(
				next,
				replaceAt(
					next.items,
					index,
					withToolCallStarted(item, event.toolCallId, event.toolName, args, event.startedAt),
				),
			);
		}
		case "tool.phase": {
			const index = findToolCallMessageIndex(state.items, event.toolCallId);
			if (index < 0) return state;
			const item = state.items[index] as AgentItem;
			return withItems(
				state,
				replaceAt(state.items, index, withToolCallPhase(item, event.toolCallId, event.label, event.atMs)),
			);
		}
		case "tool.end": {
			const index = findToolCallMessageIndex(state.items, event.toolCallId);
			if (index < 0) return state;
			const item = state.items[index] as AgentItem;
			return withItems(
				state,
				replaceAt(
					state.items,
					index,
					withToolCallEnded(item, event.toolCallId, event.result, event.isError, {
						startedAt: event.startedAt,
						durationMs: event.durationMs,
						phases: [...event.phases],
					}),
				),
			);
		}
		default:
			return state;
	}
}

function applyAssistantEvent(state: ConversationFeedState, event: AssistantSessionEvent): ConversationFeedState {
	const turnId = event.turnId ?? state.activeTurnId;
	if (!turnId) return state;
	const resolved = resolveTurnAssistant(state, turnId, event.timestamp);
	const item = resolved.items[resolved.index] as AgentItem;
	const message = reduceConversationMessageEvent(
		{ conversationId: FEED_CONVERSATION_ID, sequence: -1, message: item },
		{
			type: "conversation.agent-message-event",
			conversationId: FEED_CONVERSATION_ID,
			messageId: item.id,
			turnId,
			author: { kind: "agent", id: item.authorId },
			sequence: 0,
			timestamp: event.timestamp,
			event,
		},
	).message;
	return withItems(resolved.state, replaceAt(resolved.items, resolved.index, { ...item, ...message }));
}

/**
 * Commit a durable user message by exact identity and keep the Turn draft
 * immediately after it. This handles optimistic sends and queue-promoted
 * messages alike, without inspecting queue snapshots or matching text.
 */
function commitUserMessage(
	state: ConversationFeedState,
	event: Extract<SessionEvent, { readonly type: "conversation.message.appended" }>,
): ConversationFeedState {
	const messages = state.items;
	const text = messageText(event.message.content);
	const userIndex = messages.findIndex((item) => item.kind === "user" && item.id === event.messageId);
	const assistantIndex = findLastIndex(messages, (item) => item.kind === "agent" && item.turnId === event.turnId);
	const assistant = assistantIndex >= 0 ? messages[assistantIndex] : undefined;
	const reusesEmptyDraft =
		assistant?.kind === "agent" &&
		assistant.endedAt === undefined &&
		assistant.blocks.length === 0 &&
		!assistant.text;
	const queued = state.queuedUsers.find((user) => user.id === event.messageId);
	const existingUser = userIndex >= 0 ? messages[userIndex] : queued;
	const committedUser: UserItem =
		existingUser?.kind === "user"
			? {
					...existingUser,
					entryId: existingUser.entryId ?? event.messageId,
					turnId: event.turnId,
					deliveryPhase: "completed",
					text,
					timestamp: existingUser.timestamp ?? event.message.timestamp ?? event.timestamp,
				}
			: createConversationUserMessage({
					id: event.messageId,
					entryId: event.messageId,
					turnId: event.turnId,
					deliveryPhase: "completed",
					text,
					timestamp: event.message.timestamp ?? event.timestamp,
				});
	// Each user message inside a Turn opens the next assistant segment, like history projection.
	const segment =
		messages.filter((item) => item.kind === "user" && item.turnId === event.turnId && item.id !== event.messageId)
			.length + 1;
	const nextAssistantId = conversationAssistantMessageId(event.turnId, segment);
	const draft: AgentItem =
		reusesEmptyDraft && assistant?.kind === "agent"
			? withStableRenderKey(assistant, { ...assistant, id: nextAssistantId, turnId: event.turnId })
			: createConversationAgentMessage({
					id: nextAssistantId,
					turnId: event.turnId,
					phase: "streaming",
					text: "",
					blocks: [],
					timestamp: event.timestamp,
					startedAt: event.timestamp,
				});
	const next = messages
		.map((item, index) =>
			index === assistantIndex && !reusesEmptyDraft && item.kind === "agent" && item.endedAt === undefined
				? finishSegment(item, event.timestamp)
				: item,
		)
		.filter((_item, index) => index !== userIndex && !(reusesEmptyDraft && index === assistantIndex));
	const insertionIndex =
		userIndex >= 0
			? messages.slice(0, userIndex).filter((_item, index) => !(reusesEmptyDraft && index === assistantIndex)).length
			: reusesEmptyDraft
				? Math.min(assistantIndex, next.length)
				: assistant?.kind === "agent"
					? next.findIndex((item) => item.kind === "agent" && item.id === assistant.id) + 1
					: next.length;
	next.splice(insertionIndex, 0, committedUser);
	// The durable user message may already be followed by this segment (restored history).
	if (!next.some((item) => item.id === nextAssistantId)) next.splice(insertionIndex + 1, 0, draft);
	return {
		...state,
		items: next,
		queuedUsers: queued ? state.queuedUsers.filter((user) => user.id !== queued.id) : state.queuedUsers,
	};
}

/** Settle only the assistant message owned by the terminal Turn. */
function finishTurn(
	state: ConversationFeedState,
	event: Extract<
		SessionEvent,
		{ readonly type: "conversation.turn.completed" | "conversation.turn.cancelled" | "conversation.turn.failed" }
	>,
): ConversationFeedState {
	const activeTurnId = state.activeTurnId === event.turnId ? null : state.activeTurnId;
	const index = findLastIndex(state.items, (item) => item.kind === "agent" && item.turnId === event.turnId);
	const item = state.items[index];
	if (item?.kind !== "agent") return activeTurnId === state.activeTurnId ? state : { ...state, activeTurnId };
	let settled: AgentItem;
	if (event.type === "conversation.turn.cancelled") {
		settled = abortConversationAgentMessage(item, event.timestamp);
	} else {
		const failed = event.type === "conversation.turn.failed" || item.blocks.some((block) => block.type === "error");
		settled = {
			...item,
			phase: failed ? "failed" : "completed",
			endedAt: event.timestamp,
			...(item.startedAt === undefined
				? {}
				: { durationSeconds: Math.max(0, event.timestamp - item.startedAt) / 1_000 }),
		};
	}
	return { ...state, items: replaceAt(state.items, index, settled), activeTurnId };
}

function finishSegment(message: AgentItem, endedAt: number): AgentItem {
	return {
		...message,
		phase: message.blocks.some((block) => block.type === "error") ? "failed" : "completed",
		endedAt,
		...(message.startedAt === undefined ? {} : { durationSeconds: Math.max(0, endedAt - message.startedAt) / 1_000 }),
	};
}

/**
 * The assistant message of a Turn's current segment. It is found by identity;
 * only a renderer-local draft at the tail may be adopted, and otherwise a new
 * message is appended.
 */
function resolveTurnAssistant(
	state: ConversationFeedState,
	turnId: string,
	timestamp: number,
): { readonly state: ConversationFeedState; readonly items: readonly ChatConversationItem[]; readonly index: number } {
	const items = state.items;
	const id = currentAssistantId(items, turnId);
	const index = findLastIndex(items, (item) => item.kind === "agent" && item.id === id);
	if (index >= 0) return { state, items, index };
	const tail = items.at(-1);
	if (isLocalDraft(tail)) {
		const adopted = withStableRenderKey(tail, { ...tail, id, turnId });
		return { state, items: replaceAt(items, items.length - 1, adopted), index: items.length - 1 };
	}
	const created = createConversationAgentMessage({
		id,
		turnId,
		phase: "streaming",
		text: "",
		blocks: [],
		timestamp,
		startedAt: timestamp,
	});
	return { state, items: [...items, created], index: items.length };
}

/** Segment numbering matches history projection: one segment per user message in the Turn. */
function currentAssistantId(items: readonly ChatConversationItem[], turnId: string): string {
	const segment = items.filter((item) => item.kind === "user" && item.turnId === turnId).length;
	return conversationAssistantMessageId(turnId, segment);
}

function isLocalDraft(item: ChatConversationItem | undefined): item is AgentItem {
	return (
		item?.kind === "agent" &&
		item.id.startsWith(LOCAL_ITEM_PREFIX) &&
		item.phase === "streaming" &&
		item.endedAt === undefined
	);
}

// ─── Local actions ───

function startPendingTurn(state: ConversationFeedState, startedAt: number): ConversationFeedState {
	const tail = state.items.at(-1);
	if (tail?.kind === "agent" && tail.phase === "streaming" && tail.endedAt === undefined) return state;
	const localSequence = state.localSequence + 1;
	const draft = createConversationAgentMessage({
		id: `${LOCAL_ITEM_PREFIX}${localSequence}`,
		phase: "streaming",
		text: "",
		blocks: [],
		timestamp: startedAt,
		startedAt,
	});
	return { ...state, items: [...state.items, draft], localSequence };
}

function restoreTurn(
	state: ConversationFeedState,
	turnId: string | undefined,
	startedAt: number,
): ConversationFeedState {
	if (!turnId) {
		// Runtimes without Turn identity: only the tail can be the running message.
		const tail = state.items.at(-1);
		if (tail?.kind === "agent") {
			return withItems(state, replaceAt(state.items, state.items.length - 1, reactivate(tail, startedAt)));
		}
		return startPendingTurn(state, startedAt);
	}
	const id = currentAssistantId(state.items, turnId);
	const index = findLastIndex(state.items, (item) => item.kind === "agent" && item.id === id);
	const items =
		index >= 0
			? replaceAt(state.items, index, reactivate(state.items[index] as AgentItem, startedAt))
			: [
					...state.items,
					createConversationAgentMessage({
						id,
						turnId,
						phase: "streaming",
						text: "",
						blocks: [],
						timestamp: startedAt,
						startedAt,
					}),
				];
	return { ...state, items, activeTurnId: turnId };
}

/** Reopen a persisted assistant message whose Turn is still running; its unfinished tools are pending again. */
function reactivate(message: AgentItem, startedAt: number): AgentItem {
	return {
		...message,
		phase: "streaming",
		startedAt,
		timestamp: message.timestamp ?? startedAt,
		endedAt: undefined,
		durationSeconds: undefined,
		blocks: message.blocks.map((block) =>
			block.type === "tool_call" && block.result === undefined ? { ...block, status: "pending" as const } : block,
		),
	};
}

function appendFeedError(
	state: ConversationFeedState,
	action: Extract<ConversationFeedAction, { readonly type: "error.appended" }>,
): ConversationFeedState {
	let next = state;
	let index: number;
	if (action.turnId) {
		const resolved = resolveTurnAssistant(state, action.turnId, action.timestamp);
		next = withItems(resolved.state, resolved.items);
		index = resolved.index;
	} else if (state.items.at(-1)?.kind === "agent") {
		index = state.items.length - 1;
	} else {
		const localSequence = state.localSequence + 1;
		const item = createConversationAgentMessage({
			id: `${LOCAL_ITEM_PREFIX}${localSequence}`,
			phase: "failed",
			text: "",
			blocks: [],
			timestamp: action.timestamp,
			startedAt: action.timestamp,
		});
		next = { ...state, items: [...state.items, item], localSequence };
		index = next.items.length - 1;
	}
	const target = next.items[index] as AgentItem;
	const blocks = [...target.blocks];
	const existingIndex = action.turnId
		? blocks.findIndex((block) => block.type === "error" && block.turnId === action.turnId)
		: -1;
	const existing = existingIndex >= 0 ? blocks[existingIndex] : undefined;
	if (existing?.type === "error") {
		blocks[existingIndex] = {
			...existing,
			text: action.message,
			...(action.attempts ? { attempts: action.attempts } : {}),
			...(action.details ? { details: { ...existing.details, ...action.details } } : {}),
		};
	} else {
		const last = blocks.at(-1);
		// The same local failure reported twice (IPC rejection and its error event) shows once.
		if (!action.turnId && last?.type === "error" && !last.turnId && last.text === action.message) return next;
		blocks.push({
			type: "error",
			id: `${target.id}:error:${blocks.length}`,
			...(action.turnId ? { turnId: action.turnId } : {}),
			text: action.message,
			kind: classifyChatError(action.message),
			...(action.attempts ? { attempts: action.attempts } : {}),
			...(action.details ? { details: action.details } : {}),
		});
	}
	const settled: AgentItem =
		target.id.startsWith(LOCAL_ITEM_PREFIX) && !action.turnId ? { ...target, phase: "failed" } : target;
	return withItems(next, replaceAt(next.items, index, { ...settled, text: target.text || action.message, blocks }));
}

function updateUser(
	state: ConversationFeedState,
	id: string,
	patch: Partial<ConversationUserMessageViewModel>,
): ConversationFeedState {
	const index = state.items.findIndex((item) => item.kind === "user" && item.id === id);
	if (index >= 0) {
		const item = state.items[index] as UserItem;
		return withItems(state, replaceAt(state.items, index, { ...item, ...patch }));
	}
	const queuedIndex = state.queuedUsers.findIndex((user) => user.id === id);
	if (queuedIndex < 0) return state;
	const queuedUsers = [...state.queuedUsers];
	queuedUsers[queuedIndex] = { ...queuedUsers[queuedIndex], ...patch };
	return { ...state, queuedUsers };
}

function bindFeed(
	state: ConversationFeedState,
	runtimeId: string,
	outbox: ConversationFeedOutbox | undefined,
): ConversationFeedState {
	if (!outbox) return state.runtimeId === runtimeId ? state : { ...state, runtimeId };
	const present = new Set(state.items.map((item) => item.id));
	const queuedIds = new Set(state.queuedUsers.map((user) => user.id));
	return {
		...state,
		runtimeId,
		items: [...state.items, ...outbox.visible.filter((user) => !present.has(user.id))],
		queuedUsers: [...state.queuedUsers, ...outbox.queued.filter((user) => !queuedIds.has(user.id))],
	};
}

// ─── Durable history ───

/**
 * Merge a durable snapshot by id. Durable items take their persisted order and
 * metadata; items not yet durable stay right after the item that preceded them.
 * Items that were durable before and are missing now were deleted by history.
 */
function mergeHistory(
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
	const liveErrors = current.blocks.filter(
		(block): block is ErrorBlock =>
			block.type === "error" &&
			!durable.blocks.some((candidate) => candidate.type === "error" && sameError(candidate, block)),
	);
	return {
		...durable,
		...(current.toolCallPresentations ? { toolCallPresentations: current.toolCallPresentations } : {}),
		phase: current.phase,
		text: durable.text || current.text,
		blocks: liveErrors.length > 0 ? [...durable.blocks, ...liveErrors] : durable.blocks,
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

// ─── Helpers ───

/** Keep the DOM row when an item's identity fields change (draft adoption, durable entryId). */
function withStableRenderKey<T extends ChatConversationItem>(previous: ChatConversationItem, next: T): T {
	const key = conversationItemRenderKey(previous);
	return conversationItemRenderKey(next) === key ? next : { ...next, renderKey: key };
}

function withItems(state: ConversationFeedState, items: readonly ChatConversationItem[]): ConversationFeedState {
	return items === state.items ? state : { ...state, items };
}

function upsertItem(items: readonly ChatConversationItem[], item: ChatConversationItem): ChatConversationItem[] {
	const index = items.findIndex((candidate) => candidate.id === item.id);
	return index >= 0 ? replaceAt(items, index, item) : [...items, item];
}

function replaceAt(
	items: readonly ChatConversationItem[],
	index: number,
	item: ChatConversationItem,
): ChatConversationItem[] {
	if (items[index] === item) return items as ChatConversationItem[];
	const next = [...items];
	next[index] = item;
	return next;
}

function removeAt(items: readonly ChatConversationItem[], index: number): ChatConversationItem[] {
	return [...items.slice(0, index), ...items.slice(index + 1)];
}

function findLastIndex(
	items: readonly ChatConversationItem[],
	predicate: (item: ChatConversationItem) => boolean,
): number {
	for (let index = items.length - 1; index >= 0; index--) if (predicate(items[index])) return index;
	return -1;
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

function messageText(
	content: Extract<SessionEvent, { readonly type: "conversation.message.appended" }>["message"]["content"],
): string {
	if (typeof content === "string") return content;
	return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}
