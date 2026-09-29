import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { CodingAgentGoalSnapshot } from "./contracts.js";

export const GOAL_SNAPSHOT_TYPE = "goal_snapshot";

export const CodingAgentGoalStateSchema = Type.Object(
	{
		goalId: Type.String({ minLength: 1 }),
		objective: Type.String({ minLength: 1 }),
		status: Type.Union([
			Type.Literal("active"),
			Type.Literal("paused"),
			Type.Literal("blocked"),
			Type.Literal("usage_limited"),
			Type.Literal("complete"),
		]),
		statusDetail: Type.Optional(Type.String()),
		tokensUsed: Type.Integer({ minimum: 0 }),
		timeUsedSeconds: Type.Number({ minimum: 0 }),
		continuationCount: Type.Integer({ minimum: 0 }),
		createdAt: Type.String(),
		updatedAt: Type.String(),
	},
	{ additionalProperties: false },
);

const CodingAgentGoalSnapshotSchema = Type.Union([CodingAgentGoalStateSchema, Type.Null()]);

export function parseGoalSnapshot(value: unknown, entryId: string): CodingAgentGoalSnapshot {
	if (!Value.Check(CodingAgentGoalSnapshotSchema, value)) {
		throw new Error(`Invalid ${GOAL_SNAPSHOT_TYPE} entry: ${entryId}`);
	}
	return value;
}
