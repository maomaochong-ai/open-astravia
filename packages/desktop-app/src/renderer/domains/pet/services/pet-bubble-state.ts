import type {
	PetBubbleKind,
	PetBubbleNotice,
	PetBubblePriority,
	PetCommand,
	PetCommandSource,
} from "../../../../shared/pet-ipc";

export const DEFAULT_PET_BUBBLE_TTL_MS = 4_000;
export const MIN_PET_BUBBLE_TTL_MS = 1_000;
export const MAX_PET_BUBBLE_TTL_MS = 15_000;
export const PET_BUBBLE_MIN_HOLD_MS = 2_000;
const MAX_PENDING_PET_BUBBLES = 3;

export interface ShowPetBubbleInput extends PetBubbleNotice {
	text: string;
	source?: PetCommandSource;
}

export interface PetBubbleMessage {
	readonly id: number;
	readonly text: string;
	readonly source: PetCommandSource;
	readonly priority: PetBubblePriority;
	readonly kind?: PetBubbleKind;
	readonly messageKey?: string;
	readonly params?: Readonly<Record<string, string | number>>;
	readonly dedupeKey?: string;
	readonly sessionId?: string;
	readonly ttlMs: number;
	readonly shownAt: number;
}

export interface PetBubbleQueueState {
	readonly current?: PetBubbleMessage;
	readonly pending: readonly PetBubbleMessage[];
	readonly nextId: number;
	readonly userBubbleUntil: number;
}

export type PetBubbleQueueAction =
	| { readonly type: "show"; readonly input: ShowPetBubbleInput; readonly now: number }
	| { readonly type: "advance"; readonly messageId: number; readonly now: number }
	| { readonly type: "hide"; readonly source?: PetCommandSource; readonly now: number };

export const INITIAL_PET_BUBBLE_QUEUE_STATE: PetBubbleQueueState = {
	pending: [],
	nextId: 1,
	userBubbleUntil: 0,
};

export function normalizePetBubbleTtl(ttlMs: number | undefined): number {
	if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) return DEFAULT_PET_BUBBLE_TTL_MS;
	return Math.min(MAX_PET_BUBBLE_TTL_MS, Math.max(MIN_PET_BUBBLE_TTL_MS, ttlMs));
}

function getDedupeIdentity(message: Pick<PetBubbleMessage, "dedupeKey" | "sessionId">): string | undefined {
	if (!message.dedupeKey) return undefined;
	return `${message.sessionId ?? "global"}:${message.dedupeKey}`;
}

function isSameLegacyMessage(current: PetBubbleMessage, next: PetBubbleMessage): boolean {
	return (
		current.dedupeKey === undefined &&
		next.dedupeKey === undefined &&
		current.text === next.text &&
		current.source === next.source &&
		current.priority === next.priority
	);
}

function isSameMessageSlot(current: PetBubbleMessage, next: PetBubbleMessage): boolean {
	const identity = getDedupeIdentity(next);
	return identity ? getDedupeIdentity(current) === identity : isSameLegacyMessage(current, next);
}

function createMessage(
	state: PetBubbleQueueState,
	input: ShowPetBubbleInput,
	now: number,
): PetBubbleMessage | undefined {
	const text = input.text.trim();
	if (!text) return undefined;
	return {
		id: state.nextId,
		text,
		source: input.source ?? "app",
		priority: input.priority ?? "normal",
		ttlMs: normalizePetBubbleTtl(input.ttlMs),
		shownAt: now,
		...(input.kind === undefined ? {} : { kind: input.kind }),
		...(input.messageKey === undefined ? {} : { messageKey: input.messageKey }),
		...(input.params === undefined ? {} : { params: input.params }),
		...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
		...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
	};
}

function promotePending(
	state: PetBubbleQueueState,
	pending: readonly PetBubbleMessage[],
	now: number,
): PetBubbleQueueState {
	const [current, ...remaining] = pending;
	const { current: _current, ...withoutCurrent } = state;
	return current
		? { ...withoutCurrent, current: { ...current, shownAt: now }, pending: remaining }
		: { ...withoutCurrent, pending: [] };
}

export function reducePetBubbleQueue(state: PetBubbleQueueState, action: PetBubbleQueueAction): PetBubbleQueueState {
	if (action.type === "advance") {
		if (state.current?.id !== action.messageId) return state;
		return promotePending(state, state.pending, action.now);
	}

	if (action.type === "hide") {
		if (action.source === undefined) return { ...state, current: undefined, pending: [] };
		const pending = state.pending.filter((message) => message.source !== action.source);
		if (state.current?.source !== action.source) return { ...state, pending };
		return promotePending(state, pending, action.now);
	}

	const next = createMessage(state, action.input, action.now);
	if (!next) return state;
	if (next.source === "app" && next.priority !== "high" && action.now < state.userBubbleUntil) return state;

	const nextState = {
		...state,
		nextId: state.nextId + 1,
		userBubbleUntil: next.source === "user" ? action.now + next.ttlMs : state.userBubbleUntil,
	};
	if (state.current?.priority === "high" && next.source === "app" && next.priority !== "high") return nextState;
	if (next.source === "user") {
		return { ...nextState, current: next, pending: [] };
	}
	const identity = getDedupeIdentity(next);
	const updatesCurrent = state.current && isSameMessageSlot(state.current, next);
	if (updatesCurrent) {
		if (next.priority === "high" || action.now - state.current.shownAt >= PET_BUBBLE_MIN_HOLD_MS) {
			return {
				...nextState,
				current: next,
				pending:
					next.priority === "high" ? [] : state.pending.filter((message) => !isSameMessageSlot(message, next)),
			};
		}
		const pending = state.pending.filter((message) => !isSameMessageSlot(message, next));
		return { ...nextState, pending: [...pending, next] };
	}
	if (next.priority === "high" || !state.current) {
		return { ...nextState, current: next, pending: next.priority === "high" ? [] : state.pending };
	}

	const queuedIndex = identity ? state.pending.findIndex((message) => getDedupeIdentity(message) === identity) : -1;
	if (queuedIndex >= 0) {
		const pending = [...state.pending];
		pending[queuedIndex] = next;
		return { ...nextState, pending };
	}

	return {
		...nextState,
		pending: [...state.pending, next].slice(-MAX_PENDING_PET_BUBBLES),
	};
}

export function getShowPetBubbleInput(
	command: Extract<PetCommand, { type: "show-bubble" }>,
): ShowPetBubbleInput | undefined {
	const notice = command.notice;
	const text = command.text ?? notice?.text;
	if (typeof text !== "string" || !text.trim()) return undefined;
	return {
		...notice,
		text,
		source: command.source ?? "app",
		ttlMs: command.ttlMs ?? notice?.ttlMs,
		priority: command.priority ?? notice?.priority,
	};
}
