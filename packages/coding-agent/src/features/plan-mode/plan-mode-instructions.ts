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
		"2. **Close the gaps with the user.** A short or direct request usually leaves out things the user takes for granted. Before planning, list for yourself every decision that would change the plan:",
		"   - the outcome they want and how they will judge it done;",
		"   - the scope: what is included, and what must stay untouched;",
		"   - constraints: compatibility, existing conventions, dependencies, performance, deadlines;",
		"   - which way to go where several reasonable approaches have different trade-offs;",
		"   - for something built from scratch, the solution they want: platform and tech stack, feature set and depth, look and feel, content and assets. There is no code to settle these, so they are the user's call.",
		"   Sort each decision: already settled by the request or by what you found; has a default the user is unlikely to care about; or genuinely the user's to make. Ask only about the last kind (ask_user_question when it is available, otherwise ask in your reply and stop). Ground the questions in what you found, and offer concrete options with your recommendation rather than open-ended questions.",
		"   Walk the decisions in dependency order: start with the ones that shape everything else, then use the answers to decide what is still worth asking. There is no fixed number of rounds. What ends the questioning is the list, not a count: keep going while a decision that would materially change the plan is still open, and stop the moment none is. A one-line request to build an entire application normally takes several exchanges; a precise change to existing code often takes none.",
		"   Do not interrogate: every question must be able to change the plan, never re-ask what an answer already implies, and keep each round to the few questions that matter most right now. If the user says to decide the rest yourself, stop asking immediately. Skip this step entirely when the request is already precise.",
		"3. **Design the approach** once requirements and boundaries are clear: what changes, where, in what order, how it is verified, and what could go wrong. In the plan, list the decisions the user confirmed and, separately, the defaults you assumed for everything you did not ask, so they can correct any of them during review.",
		options.canSubmitPlan
			? `4. **Submit the complete plan** with ${CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME}. Do not paste the full plan into your reply as well — the user reviews it in the approval panel.`
			: "4. **Present the complete plan** as your reply, then stop. The user will switch plan mode off when they want you to execute it.",
		"",
		"A blocked tool call means the action is not allowed right now, not that you should find another route to the same effect.",
		"If the request needs no changes at all (a question, an explanation, a review), just answer it; no plan is required.",
	].join("\n");
}
