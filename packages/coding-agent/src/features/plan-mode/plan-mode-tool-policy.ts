import { classifyPlanModeCommand } from "./plan-mode-command-policy.js";

export const CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME = "exit_plan_mode";

export type PlanModeToolVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

const ALLOWED: PlanModeToolVerdict = Object.freeze({ allowed: true });

/**
 * Plan 模式下无条件可用的工具：只读取工作区、只与用户或会话内状态交互。
 *
 * 白名单而非黑名单：MCP、插件与扩展工具的副作用宿主无从判定（MCP 的 readOnlyHint 只是服务端
 * 自述），默认全部不可见。新增内置只读工具时须显式登记到这里。
 */
const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"glob",
	"find",
	"ls",
	"dir_tree",
	"render_pdf_page",
	"extract_text_from_pdf",
	"extract_text_from_img",
	"current_time",
	"progress",
	"todo",
	"invoke_skill",
	"ask_user_question",
	"kb_filter_by_tags",
	"kb_list_available_tags",
	"task_output",
	"list_agents",
	"wait_agent",
	"interrupt_agent",
	CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME,
]);

/** 同一个工具既能读又能写：保留在工具面上，由调用参数决定是否放行。 */
const COMMAND_TOOL_NAMES: ReadonlySet<string> = new Set(["bash", "shell"]);
const SPAWN_AGENT_TOOL_NAME = "spawn_agent";
const READ_ONLY_SUBAGENT_TYPE = "explorer";

/** 工具面（schema）闸门：Plan 模式下该工具是否出现在模型的工具数组里。 */
export function isToolVisibleInPlanMode(toolName: string): boolean {
	return READ_ONLY_TOOL_NAMES.has(toolName) || COMMAND_TOOL_NAMES.has(toolName) || toolName === SPAWN_AGENT_TOOL_NAME;
}

/**
 * 把 Plan 闸门叠加到既有的工具选择之上。`exit_plan_mode` 不受 Agent 配置的工具白名单约束：
 * 它是离开只读态的唯一出口，被配置筛掉会让会话卡死在 Plan 模式。
 */
export function composePlanModeToolSelection(
	isPlanActive: () => boolean,
	base: (toolName: string) => boolean,
): (toolName: string) => boolean {
	return (toolName) => {
		if (!isPlanActive()) return base(toolName);
		if (toolName === CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME) return true;
		return isToolVisibleInPlanMode(toolName) && base(toolName);
	};
}

/**
 * 执行闸门：工具面闸门之后的第二道防线，同时裁决「看参数才知道读写」的工具。
 * 即使工具面因竞态或宿主缺陷漏出了写工具，调用也会在这里被拒绝。
 */
export function evaluatePlanModeToolCall(
	toolName: string,
	input: Readonly<Record<string, unknown>>,
): PlanModeToolVerdict {
	if (READ_ONLY_TOOL_NAMES.has(toolName)) return ALLOWED;
	if (COMMAND_TOOL_NAMES.has(toolName)) {
		if (input.run_in_background === true) return deny(toolName, "background commands are not allowed");
		const verdict = classifyPlanModeCommand(typeof input.command === "string" ? input.command : "");
		return verdict.allowed ? ALLOWED : deny(toolName, verdict.reason);
	}
	if (toolName === SPAWN_AGENT_TOOL_NAME) {
		return input.agent_type === READ_ONLY_SUBAGENT_TYPE
			? ALLOWED
			: deny(toolName, `only the read-only "${READ_ONLY_SUBAGENT_TYPE}" subagent type is allowed`);
	}
	return deny(toolName, "it can change files or external state");
}

function deny(toolName: string, reason: string): PlanModeToolVerdict {
	return {
		allowed: false,
		reason:
			`Plan mode is active, so ${toolName} was blocked: ${reason}. ` +
			`Keep researching with read-only tools, then call ${CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME} ` +
			"to submit your plan for the user's approval. Do not try to work around this restriction.",
	};
}
