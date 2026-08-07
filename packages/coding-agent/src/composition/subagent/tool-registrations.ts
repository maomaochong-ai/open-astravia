import type { SubagentCoordinatorPort } from "@vetta/runtime-subagents";
import {
	createDispatchWorkflowsToolRegistration,
	createFollowupTaskToolRegistration,
	createInterruptAgentToolRegistration,
	createListAgentsToolRegistration,
	createSendMessageToolRegistration,
	createSpawnAgentToolRegistration,
	createWaitAgentToolRegistration,
} from "@vetta/runtime-tools/coding";
import {
	CODING_AGENT_MODEL_TOOL_ORDER,
	CODING_AGENT_SUBAGENT_MODEL_TOOL_ORDER_STEP,
} from "../../tool-policy/model-tool-order.js";

/** 组装产品工具顺序；工具定义与执行归 @vetta/runtime-tools 所有。 */
export function createCodingAgentSubagentRuntimeToolRegistrations(
	getCoordinator: () => SubagentCoordinatorPort | undefined,
	workflowTypeId = "workflow",
) {
	const order = (index: number) =>
		CODING_AGENT_MODEL_TOOL_ORDER.subagentStart + index * CODING_AGENT_SUBAGENT_MODEL_TOOL_ORDER_STEP;
	return [
		createSpawnAgentToolRegistration({ getCoordinator, modelOrder: order(0) }),
		createDispatchWorkflowsToolRegistration({ getCoordinator, workflowTypeId, modelOrder: order(1) }),
		createWaitAgentToolRegistration({ getCoordinator, workflowTypeId, modelOrder: order(2) }),
		createListAgentsToolRegistration({ getCoordinator, modelOrder: order(3) }),
		createInterruptAgentToolRegistration({ getCoordinator, modelOrder: order(4) }),
		createSendMessageToolRegistration({ getCoordinator, modelOrder: order(5) }),
		createFollowupTaskToolRegistration({ getCoordinator, modelOrder: order(6) }),
	] as const;
}
