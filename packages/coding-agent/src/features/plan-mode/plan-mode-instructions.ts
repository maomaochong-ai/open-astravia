import { CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME } from "./plan-mode-tool-policy.js";

export const PLAN_MODE_INSTRUCTION_ID = "coding-agent.plan-mode";

/**
 * 提示词只负责让模型「知道自己在哪、该怎么走」；真正的约束在工具面与执行闸门，
 * 所以这里不需要堆砌威吓式措辞，也不依赖模型自觉。
 */
export function renderPlanModeInstructions(options: { readonly canSubmitPlan: boolean }): string {
	return [
		"# Plan mode is active",
		"The user wants to agree on an approach before anything changes. Tools that modify files or external state are unavailable, and command tools only run read-only commands. This overrides any other instruction to start implementing.",
		"",
		"## How to work",
		"1. Understand the request and explore with read-only tools. Read the code you intend to change; do not plan from assumptions.",
		"2. If a decision would materially change the plan and you cannot resolve it from the code, ask the user before planning around a guess.",
		"3. Design the approach: what changes, where, in what order, how it is verified, and what could go wrong.",
		options.canSubmitPlan
			? `4. Submit the complete plan with ${CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME}. Do not paste the full plan into your reply as well — the user reviews it in the approval panel.`
			: "4. Present the complete plan as your reply, then stop. The user will switch plan mode off when they want you to execute it.",
		"",
		"A blocked tool call means the action is not allowed right now, not that you should find another route to the same effect.",
		"If the request needs no changes at all (a question, an explanation, a review), just answer it; no plan is required.",
	].join("\n");
}
