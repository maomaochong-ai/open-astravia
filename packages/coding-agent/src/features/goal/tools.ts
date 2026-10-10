import type { RuntimeToolDefinition } from "@astravia/runtime-core/kernel";
import { type Static, Type } from "@sinclair/typebox";
import type { ConversationScenario } from "../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
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

/** 仅在支持 Goal 模式的场景可见；显式激活仍由 `selectCodingAgentToolRegistrations` 决定。 */
export const GOAL_TOOL_SCOPES = ["conversation", "project", "cli"] as const satisfies readonly ConversationScenario[];
export const GOAL_TOOL_CATEGORY = "agent-control" as const;
/**
 * Goal 工具的产品策略元数据。激活判定必须走 Registration，
 * 否则显式激活会把工具注入到只允许部分工具的会话里。
 */
export function createGoalToolRegistrations(
	runtime: CodingAgentGoalRuntime,
): readonly CodingAgentRuntimeToolRegistration[] {
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
	return [getGoal, createGoal, updateGoal].map((tool) => ({
		tool,
		scopeUse: GOAL_TOOL_SCOPES,
		modelOrder: tool.modelOrder,
		category: GOAL_TOOL_CATEGORY,
	}));
}

function textResult(value: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
		details: value,
	};
}
