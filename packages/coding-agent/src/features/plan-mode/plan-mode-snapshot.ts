import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { CodingAgentPlanModeState } from "./contracts.js";

export const PLAN_MODE_SNAPSHOT_TYPE = "plan_mode_snapshot";

export const CodingAgentPlanModeStateSchema = Type.Object(
	{
		permissionMode: Type.Union([Type.Literal("default"), Type.Literal("plan")]),
		plan: Type.Optional(
			Type.Object(
				{
					content: Type.String(),
					status: Type.Union([
						Type.Literal("pending-review"),
						Type.Literal("approved"),
						Type.Literal("changes-requested"),
						Type.Literal("dismissed"),
					]),
					updatedAt: Type.String(),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export function parsePlanModeSnapshot(value: unknown, entryId: string): CodingAgentPlanModeState {
	if (!Value.Check(CodingAgentPlanModeStateSchema, value)) {
		throw new Error(`Invalid ${PLAN_MODE_SNAPSHOT_TYPE} entry: ${entryId}`);
	}
	return value;
}
