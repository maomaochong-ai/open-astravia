import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import type { CodingAgentGoalStatus } from "./contracts.js";
import type { CodingAgentGoalRuntime } from "./goal-runtime.js";

const GetGoalInputSchema = Type.Object({}, { additionalProperties: false });
const CreateGoalInputSchema = Type.Object(
	{
		objective: Type.String({ minLength: 1, description: "The concrete objective explicitly requested by the user." }),
	},
	{ additionalProperties: false },
);
const UpdateGoalInputSchema = Type.Object(
	{
		goal_id: Type.String({ minLength: 1 }),
		status: Type.Union([Type.Literal("complete"), Type.Literal("blocked"), Type.Literal("paused")]),
		detail: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

type CreateGoalInput = Static<typeof CreateGoalInputSchema>;
type UpdateGoalInput = Static<typeof UpdateGoalInputSchema>;

export function createGoalTools(runtime: CodingAgentGoalRuntime): readonly RuntimeToolDefinition[] {
	const getGoal: RuntimeToolDefinition<Static<typeof GetGoalInputSchema>> = {
		name: "get_goal",
		label: "get_goal",
		description: "Read the current session goal and its status, budget, usage, and progress.",
		inputSchema: GetGoalInputSchema,
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.getGoal,
		async execute() {
			return textResult(runtime.readState() ?? { status: "none" });
		},
	};
	const createGoal: RuntimeToolDefinition<CreateGoalInput> = {
		name: "create_goal",
		label: "create_goal",
		description:
			"Create an autonomous session goal only when the user explicitly asks to start goal mode or pursue a goal autonomously. Fails while an unfinished goal exists.",
		inputSchema: CreateGoalInputSchema,
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.createGoal,
		async execute({ input }) {
			return textResult(runtime.create(input.objective));
		},
	};
	const updateGoal: RuntimeToolDefinition<UpdateGoalInput> = {
		name: "update_goal",
		label: "update_goal",
		description:
			"Update the active goal after auditing real progress. Use complete only when the objective is achieved, blocked only after the same blocker persists for three goal continuations, or paused when continued work requires the user.",
		inputSchema: UpdateGoalInputSchema,
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.updateGoal,
		async execute({ input }) {
			return textResult(runtime.update(input.goal_id, input.status as CodingAgentGoalStatus, input.detail));
		},
	};
	return [getGoal, createGoal, updateGoal];
}

function textResult(value: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
		details: value,
	};
}
