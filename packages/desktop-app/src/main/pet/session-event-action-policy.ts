import type { SessionEvent } from "@vetta/runtime-core";
import { getPetActionsByGroup, type PetActionGroupId, type PetActionId } from "../../shared/pet-actions.js";
import type { PetBubbleNotice } from "../../shared/pet-ipc.js";

type SessionLifecyclePhase = Extract<SessionEvent, { type: "session.lifecycle" }>["phase"];
type BackgroundTasksEvent = Extract<SessionEvent, { type: "background_tasks_update" }>;

interface PetActionIntent {
	readonly groupId: PetActionGroupId;
	readonly actionId?: PetActionId;
}

interface PetPresentationIntent {
	readonly action?: PetActionIntent;
	readonly bubble?: PetBubbleNotice;
}

export interface PetPresentation {
	readonly actionId?: PetActionId;
	readonly bubble?: PetBubbleNotice;
}

interface SessionPetActionRule {
	readonly name: string;
	resolve(event: SessionEvent): PetPresentationIntent | null;
}

const MAX_TOOL_BUBBLE_TEXT_LENGTH = 48;

const DEFAULT_ACTION_BY_GROUP = {
	idle: "stoat_spin_color_hula_hoop",
	working: "stoat_work_laptop_typing_desk_cushion",
	resting: "stoat_sit_cushion_drink_tea_slow",
	feedback: "stoat_stand_lift_barbell_one_hand_fast",
} satisfies Record<PetActionGroupId, PetActionId>;

const LIFECYCLE_INTENTS: Partial<Record<SessionLifecyclePhase, PetPresentationIntent>> = {
	agent_start: {
		action: { groupId: "working" },
		bubble: { kind: "status", messageKey: "notice.lifecycle.started", ttlMs: 3_000, dedupeKey: "session-status" },
	},
	agent_end: {
		action: { groupId: "feedback", actionId: "stoat_stand_lift_barbell_one_hand_fast" },
		bubble: {
			kind: "success",
			messageKey: "notice.lifecycle.completed",
			ttlMs: 4_000,
			dedupeKey: "session-status",
		},
	},
	aborted: {
		action: { groupId: "resting", actionId: "stoat_sleep_lie_on_cushion" },
		bubble: { kind: "warning", messageKey: "notice.lifecycle.paused", ttlMs: 4_000, dedupeKey: "session-status" },
	},
};

const EVENT_TYPE_INTENTS: Partial<Record<SessionEvent["type"], PetPresentationIntent>> = {
	"compaction.start": {
		action: { groupId: "resting" },
		bubble: { kind: "status", messageKey: "notice.context.compacting", ttlMs: 3_000, dedupeKey: "session-status" },
	},
	error: {
		action: { groupId: "feedback", actionId: "stoat_wave_backflip_smoke_fade_exit" },
		bubble: {
			kind: "error",
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

function getToolBubbleNotice(event: Extract<SessionEvent, { type: "tool.start" }>): PetBubbleNotice {
	const args = getRecord(event.args);
	const description = typeof args?.description === "string" ? args.description.trim() : "";
	return description
		? {
				kind: "tool",
				messageKey: "notice.tool.runningWithDescription",
				params: { description: truncateBubbleText(description) },
				ttlMs: 3_000,
				dedupeKey: "session-status",
			}
		: {
				kind: "tool",
				messageKey: "notice.tool.running",
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
			action: { groupId: "working" },
			bubble: { kind: "status", messageKey: "notice.background.running", ttlMs: 3_000, dedupeKey: "background" },
		},
		matches: (event) => event.tasks.some((task) => task.status === "running"),
	},
	{
		intent: {
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
		resolve: (event) =>
			event.type === "background_tasks_update"
				? (BACKGROUND_TASK_INTENTS.find((rule) => rule.matches(event))?.intent ?? null)
				: null,
	},
	{
		name: "tool-description",
		resolve: (event) =>
			event.type === "tool.start"
				? {
						action: { groupId: "working" },
						bubble: getToolBubbleNotice(event),
					}
				: null,
	},
	{
		name: "event-type",
		resolve: (event) => EVENT_TYPE_INTENTS[event.type] ?? null,
	},
];

function resolvePetActionIntent(intent: PetActionIntent): PetActionId {
	return intent.actionId ?? DEFAULT_ACTION_BY_GROUP[intent.groupId] ?? getPetActionsByGroup(intent.groupId)[0].id;
}

function resolvePetPresentationIntent(intent: PetPresentationIntent): PetPresentation {
	return {
		actionId: intent.action ? resolvePetActionIntent(intent.action) : undefined,
		bubble: intent.bubble,
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
