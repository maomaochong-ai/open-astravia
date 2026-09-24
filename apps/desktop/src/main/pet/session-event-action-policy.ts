import { readCodingAgentBackgroundTasksObservation } from "@vetta/coding-agent/session-extensions";
import type { SessionEvent } from "@vetta/runtime-core";
import type { BackgroundCommandSnapshot } from "@vetta/runtime-tools";
import { getPetActionsByGroup, type PetActionGroupId, type PetActionId } from "../../shared/pet-actions.js";
import type { PetActivityState, PetBubbleNotice } from "../../shared/pet-ipc.js";

type SessionLifecyclePhase = Extract<SessionEvent, { type: "session.lifecycle" }>["phase"];
interface BackgroundTasksEvent {
	readonly tasks: readonly BackgroundCommandSnapshot[];
}

interface PetActionIntent {
	readonly groupId: PetActionGroupId;
	readonly actionId?: PetActionId;
}

interface PetPresentationIntent {
	readonly state?: PetActivityState;
	readonly action?: PetActionIntent;
	readonly bubble?: PetBubbleNotice;
}

export interface PetPresentation {
	readonly state?: PetActivityState;
	readonly actionId?: PetActionId;
	readonly bubble?: PetBubbleNotice;
}

interface SessionPetActionRule {
	readonly name: string;
	resolve(event: SessionEvent): PetPresentationIntent | null;
}

const MAX_TOOL_BUBBLE_TEXT_LENGTH = 48;
const MAX_BODY_TEXT_LENGTH = 120;

const DEFAULT_ACTION_BY_GROUP = {
	idle: "stoat_spin_color_hula_hoop",
	working: "stoat_work_laptop_typing_desk_cushion",
	resting: "stoat_sit_cushion_drink_tea_slow",
	feedback: "stoat_stand_lift_barbell_one_hand_fast",
} satisfies Record<PetActionGroupId, PetActionId>;

const ACTION_BY_STATE = {
	idle: "stoat_spin_color_hula_hoop",
	thinking: "stoat_work_laptop_typing_desk_cushion",
	working: "stoat_work_laptop_typing_desk_cushion",
	waiting_input: "stoat_sit_cushion_drink_tea_slow",
	success: "stoat_stand_lift_barbell_one_hand_fast",
	error: "stoat_wave_backflip_smoke_fade_exit",
	paused: "stoat_sleep_lie_on_cushion",
} satisfies Record<PetActivityState, PetActionId>;

const LIFECYCLE_INTENTS: Partial<Record<SessionLifecyclePhase, PetPresentationIntent>> = {
	agent_start: {
		state: "thinking",
		action: { groupId: "working" },
		bubble: {
			kind: "status",
			messageKey: "notice.lifecycle.started",
			persistent: true,
			ttlMs: 3_000,
			dedupeKey: "session-status",
		},
	},
	agent_end: {
		state: "success",
		action: { groupId: "feedback", actionId: "stoat_stand_lift_barbell_one_hand_fast" },
		bubble: {
			kind: "success",
			messageKey: "notice.lifecycle.completed",
			ttlMs: 4_000,
			dedupeKey: "session-status",
		},
	},
	aborted: {
		state: "paused",
		action: { groupId: "resting", actionId: "stoat_sleep_lie_on_cushion" },
		bubble: { kind: "warning", messageKey: "notice.lifecycle.paused", ttlMs: 4_000, dedupeKey: "session-status" },
	},
};

const EVENT_TYPE_INTENTS: Partial<Record<SessionEvent["type"], PetPresentationIntent>> = {
	"compaction.start": {
		state: "thinking",
		action: { groupId: "resting" },
		bubble: {
			kind: "status",
			messageKey: "notice.context.compacting",
			persistent: true,
			ttlMs: 3_000,
			dedupeKey: "session-status",
		},
	},
	error: {
		state: "error",
		action: { groupId: "feedback", actionId: "stoat_wave_backflip_smoke_fade_exit" },
		bubble: {
			kind: "error",
			body: undefined,
			messageKey: "notice.error.generic",
			ttlMs: 5_000,
			priority: "high",
			dedupeKey: "session-status",
		},
	},
};

function getRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function truncateBubbleText(text: string): string {
	return text.length <= MAX_TOOL_BUBBLE_TEXT_LENGTH ? text : `${text.slice(0, MAX_TOOL_BUBBLE_TEXT_LENGTH - 1)}…`;
}

function normalizeBodyText(value: string, maxLength = MAX_BODY_TEXT_LENGTH): string | undefined {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function getAssistantBody(message: Extract<SessionEvent, { type: "message.final" }>["message"]): string | undefined {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
	const text = message.content
		.filter((part): part is { type: "text"; text: string } => {
			const record = getRecord(part);
			return record?.type === "text" && typeof record.text === "string";
		})
		.map((part) => part.text)
		.join(" ");
	return normalizeBodyText(text);
}

function getToolResultBody(event: Extract<SessionEvent, { type: "tool.end" }>): string | undefined {
	return typeof event.result === "string" ? normalizeBodyText(event.result) : undefined;
}

function getToolBubbleNotice(event: Extract<SessionEvent, { type: "tool.start" }>): PetBubbleNotice {
	const args = getRecord(event.args);
	const description = typeof args?.description === "string" ? args.description.trim() : "";
	return description
		? {
				kind: "tool",
				body: truncateBubbleText(description),
				persistent: true,
				ttlMs: 3_000,
				dedupeKey: "session-status",
			}
		: {
				kind: "tool",
				messageKey: "notice.tool.running",
				persistent: true,
				ttlMs: 3_000,
				dedupeKey: "session-status",
			};
}

const BACKGROUND_TASK_INTENTS: readonly {
	readonly intent: PetPresentationIntent;
	matches(event: BackgroundTasksEvent): boolean;
}[] = [
	{
		intent: {
			state: "working",
			action: { groupId: "working" },
			bubble: { kind: "status", messageKey: "notice.background.running", ttlMs: 3_000, dedupeKey: "background" },
		},
		matches: (event) => event.tasks.some((task) => task.status === "running"),
	},
	{
		intent: {
			state: "error",
			action: { groupId: "feedback", actionId: "stoat_wave_backflip_smoke_fade_exit" },
			bubble: {
				kind: "error",
				messageKey: "notice.background.failed",
				ttlMs: 5_000,
				priority: "high",
				dedupeKey: "background",
			},
		},
		matches: (event) => event.tasks.some((task) => task.status === "failed" || task.status === "killed"),
	},
	{
		intent: {
			state: "success",
			action: { groupId: "feedback", actionId: "stoat_stand_lift_barbell_one_hand_fast" },
			bubble: {
				kind: "success",
				messageKey: "notice.background.completed",
				ttlMs: 4_000,
				dedupeKey: "background",
			},
		},
		matches: (event) => event.tasks.length > 0 && event.tasks.every((task) => task.status === "completed"),
	},
];

const sessionPetActionRules: readonly SessionPetActionRule[] = [
	{
		name: "session-lifecycle",
		resolve: (event) => (event.type === "session.lifecycle" ? (LIFECYCLE_INTENTS[event.phase] ?? null) : null),
	},
	{
		name: "background-tasks",
		resolve: (event) => {
			const tasks = readCodingAgentBackgroundTasksObservation(event);
			return tasks ? (BACKGROUND_TASK_INTENTS.find((rule) => rule.matches({ tasks }))?.intent ?? null) : null;
		},
	},
	{
		name: "tool-description",
		resolve: (event) =>
			event.type === "tool.start"
				? {
						state: "working",
						action: { groupId: "working" },
						bubble: getToolBubbleNotice(event),
					}
				: null,
	},
	{
		name: "assistant-final-body",
		resolve: (event) => {
			const message =
				event.type === "message.final"
					? event.message
					: event.channel === "assistant" && event.type === "done"
						? event.message
						: event.channel === "assistant" && event.type === "error"
							? event.error
							: undefined;
			if (!message) return null;
			const body = getAssistantBody(message);
			return body
				? {
						bubble: {
							kind: "success",
							body,
							messageKey: "notice.lifecycle.completed",
							ttlMs: 3_000,
							dedupeKey: "session-status",
						},
					}
				: null;
		},
	},
	{
		name: "tool-phase",
		resolve: (event) =>
			event.type === "tool.phase"
				? {
						state: "working",
						action: { groupId: "working" },
						bubble: {
							kind: "tool",
							body: normalizeBodyText(event.label, MAX_TOOL_BUBBLE_TEXT_LENGTH),
							persistent: true,
							ttlMs: 3_000,
							dedupeKey: "session-status",
						},
					}
				: null,
	},
	{
		name: "tool-end",
		resolve: (event) =>
			event.type === "tool.end"
				? {
						state: event.isError ? "error" : "working",
						action: { groupId: event.isError ? "feedback" : "working" },
						bubble: {
							kind: event.isError ? "error" : "success",
							body: event.isError ? getToolResultBody(event) : undefined,
							messageKey: event.isError ? "notice.error.generic" : "notice.tool.completed",
							ttlMs: event.isError ? 5_000 : 3_000,
							priority: event.isError ? "high" : "normal",
							dedupeKey: "session-status",
						},
					}
				: null,
	},
	{
		name: "retry",
		resolve: (event) =>
			event.type === "retry.start"
				? {
						state: "working",
						action: { groupId: "working" },
						bubble: {
							kind: "warning",
							body: normalizeBodyText(event.errorMessage),
							messageKey: "notice.retry.running",
							params: { attempt: event.attempt, maxAttempts: event.maxAttempts },
							persistent: true,
							ttlMs: 3_000,
							dedupeKey: "session-status",
						},
					}
				: null,
	},
	{
		name: "thinking-phase",
		resolve: (event) =>
			(event.type === "session.lifecycle" && event.phase === "turn_start") || event.type === "model.request.started"
				? { state: "thinking", action: { groupId: "working" } }
				: null,
	},
	{
		name: "event-type",
		resolve: (event) => {
			if (event.channel === "assistant") return null;
			const intent = EVENT_TYPE_INTENTS[event.type];
			if (event.type === "error" && intent?.bubble) {
				return { ...intent, bubble: { ...intent.bubble, body: normalizeBodyText(event.error.message) } };
			}
			return intent ?? null;
		},
	},
];

function resolvePetActionIntent(intent: PetActionIntent): PetActionId {
	return intent.actionId ?? DEFAULT_ACTION_BY_GROUP[intent.groupId] ?? getPetActionsByGroup(intent.groupId)[0].id;
}

function resolvePetPresentationIntent(intent: PetPresentationIntent): PetPresentation {
	return {
		...(intent.state ? { state: intent.state } : {}),
		...(intent.action ? { actionId: resolvePetActionIntent(intent.action) } : {}),
		...(intent.bubble ? { bubble: intent.bubble } : {}),
	};
}

export function createPetStatePresentation(
	state: PetActivityState,
	bubble?: PetBubbleNotice,
): PetPresentation & { state: PetActivityState; actionId: PetActionId } {
	return {
		state,
		actionId: ACTION_BY_STATE[state],
		...(bubble ? { bubble } : {}),
	};
}

export function mapSessionEventToPetPresentation(event: SessionEvent): PetPresentation | null {
	for (const rule of sessionPetActionRules) {
		const intent = rule.resolve(event);
		if (intent) return resolvePetPresentationIntent(intent);
	}
	return null;
}

export function mapSessionEventToPetAction(event: SessionEvent): PetActionId | null {
	return mapSessionEventToPetPresentation(event)?.actionId ?? null;
}
