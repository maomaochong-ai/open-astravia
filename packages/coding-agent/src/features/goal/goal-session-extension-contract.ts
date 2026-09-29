import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { SessionEvent } from "@vetta/runtime-core";
import {
	defineSessionExtensionEndpoint,
	defineSessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import type { CodingAgentGoalSnapshot, CodingAgentGoalState, CodingAgentGoalStatus } from "./contracts.js";
import { CODING_AGENT_GOAL_EXTENSION_ID } from "./contracts.js";
import { CodingAgentGoalStateSchema } from "./goal-snapshot.js";

export const CODING_AGENT_GOAL_STATE_READ = defineSessionExtensionEndpoint<void, CodingAgentGoalSnapshot>(
	CODING_AGENT_GOAL_EXTENSION_ID,
	"read",
);

export const CODING_AGENT_GOAL_CREATE = defineSessionExtensionEndpoint<
	{ readonly objective: string },
	CodingAgentGoalState
>(CODING_AGENT_GOAL_EXTENSION_ID, "create");

export const CODING_AGENT_GOAL_UPDATE = defineSessionExtensionEndpoint<
	{ readonly goalId: string; readonly status: CodingAgentGoalStatus; readonly statusDetail?: string },
	CodingAgentGoalState
>(CODING_AGENT_GOAL_EXTENSION_ID, "update");

export const CODING_AGENT_GOAL_CLEAR = defineSessionExtensionEndpoint<{ readonly goalId: string }, null>(
	CODING_AGENT_GOAL_EXTENSION_ID,
	"clear",
);

export const CODING_AGENT_GOAL_OBSERVATION = defineSessionExtensionObservation<CodingAgentGoalSnapshot>(
	CODING_AGENT_GOAL_EXTENSION_ID,
	"changed",
);

const GoalObservationSchema = Type.Union([CodingAgentGoalStateSchema, Type.Null()]);

export function readCodingAgentGoalObservation(event: SessionEvent): CodingAgentGoalSnapshot | undefined {
	if (
		event.type !== "session.extension" ||
		event.extensionId !== CODING_AGENT_GOAL_OBSERVATION.extensionId ||
		event.event !== CODING_AGENT_GOAL_OBSERVATION.event ||
		!Value.Check(GoalObservationSchema, event.payload)
	) {
		return undefined;
	}
	return event.payload ? { ...event.payload } : null;
}
