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
		"Work in this order. Do not skip ahead to the plan: a plan built on guessed requirements wastes the user's review.",
		"",
		"1. **Explore first.** Read the code, files and context the request touches with read-only tools. Do not plan from assumptions, and do not ask the user things you can find out yourself.",
		"2. **Close the gaps with the user.** A short or direct request usually leaves out things the user takes for granted. Before planning, check whether you actually know:",
		"   - the outcome they want and how they will judge it done;",
		"   - the scope: what is included, and what must stay untouched;",
		"   - constraints: compatibility, existing conventions, dependencies, performance, deadlines;",
		"   - which way to go where the code allows several reasonable approaches with different trade-offs.",
		"   If any of these is unclear and the answer would change the plan, ask. Put the questions in ONE round (ask_user_question when it is available, otherwise ask in your reply and stop), ground them in what you found, and offer concrete options with your recommendation rather than open-ended questions. Ask a follow-up round only if the answers open a new fork.",
		"   Do not interrogate: skip questions with an obvious default, and skip this step entirely when the request is already precise. State the defaults you assumed in the plan instead.",
		"3. **Design the approach** once requirements and boundaries are clear: what changes, where, in what order, how it is verified, and what could go wrong.",
		options.canSubmitPlan
			? `4. **Submit the complete plan** with ${CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME}. Do not paste the full plan into your reply as well — the user reviews it in the approval panel.`
			: "4. **Present the complete plan** as your reply, then stop. The user will switch plan mode off when they want you to execute it.",
		"",
		"A blocked tool call means the action is not allowed right now, not that you should find another route to the same effect.",
		"If the request needs no changes at all (a question, an explanation, a review), just answer it; no plan is required.",
	].join("\n");
}
