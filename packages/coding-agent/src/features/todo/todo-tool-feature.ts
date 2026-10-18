import type {
	AgentFeatureDefinition,
	ModelCallContribution,
	ModelCallContributionProvider,
} from "@astravia/runtime-core/kernel";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import type { CodingAgentTodoRuntime } from "./contracts.js";
import { renderTodoInstructions, TODO_INSTRUCTION_ID, TODO_INSTRUCTION_PRIORITY } from "./todo-instructions.js";
import { createTodoToolRegistration, type TodoToolInput } from "./tool/index.js";

export function createCodingAgentTodoRuntimeToolRegistration(
	runtime: CodingAgentTodoRuntime,
): CodingAgentRuntimeToolRegistration<TodoToolInput> {
	const registration = createTodoToolRegistration({
		getTodoStore: () => runtime,
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.todo,
	});
	return {
		...registration,
		tool: {
			...registration.tool,
			async execute(request) {
				const result = await registration.tool.execute(request);
				await runtime.flush();
				return result;
			},
		},
	};
}

export function createCodingAgentTodoRuntimeFeature(
	runtime: CodingAgentTodoRuntime,
	registration: CodingAgentRuntimeToolRegistration<TodoToolInput>,
): AgentFeatureDefinition {
	const createProvider = (): ModelCallContributionProvider => {
		// Turn 局部：只在该 Turn 首次模型调用前判定一次，避免 Turn 中途的模型调用
		// 把正在使用的计划清掉。
		let turnBound = false;
		return {
			id: "coding-agent.todo",
			bindForTurn: () => createProvider(),
			async contribute(context): Promise<ModelCallContribution> {
				context.signal.throwIfAborted();
				if (!turnBound) {
					turnBound = true;
					// 只有带用户消息的 Turn 才算「新的一轮」；续跑与自动继续没有 input。
					if (context.input) clearCompletedPlan(runtime);
				}
				const items = runtime.readItems();
				return {
					tools: [registration.tool],
					...(items.length > 0
						? {
								instructions: [
									{
										id: TODO_INSTRUCTION_ID,
										content: renderTodoInstructions(items),
										priority: TODO_INSTRUCTION_PRIORITY,
									},
								],
							}
						: {}),
				};
			},
		};
	};
	return {
		id: "coding-agent.todo",
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return { modelCallProviders: [createProvider()] };
				},
				async dispose() {},
			};
		},
	};
}

/**
 * 上一份计划若已全部完成，在新用户回合开始时清空：面板与模型都不该在换任务时
 * 还看到一份做完的旧清单。
 *
 * 仍有未完成项的清单一律保留——用户说「继续」时它仍然有效，Runtime 无法替用户
 * 判断任务是否换向；这种情况交给「清单可见 + 模型自行 clear/create」处理，
 * 而不是自动丢弃。
 */
function clearCompletedPlan(runtime: CodingAgentTodoRuntime): void {
	const items = runtime.readItems();
	if (items.length === 0 || items.some((item) => item.status !== "done")) return;
	runtime.clear();
}
