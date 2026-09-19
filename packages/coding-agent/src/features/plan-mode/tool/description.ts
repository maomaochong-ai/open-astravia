export const EXIT_PLAN_MODE_TOOL_DESCRIPTION = `Submit your implementation plan for the user's approval. This is the only way to leave plan mode and regain tools that modify files or external state.

Call this once your research is done and the plan is concrete enough to execute without further discovery. The call blocks while the user reviews the plan; they can approve it, edit it, or send it back with feedback.

Usage notes:
- \`plan\` is the complete plan in Markdown, written in the language of the user's latest message. Each call replaces the previous submission, so always send the full plan rather than a diff.
- Structure the plan as numbered steps the user can comment on individually. Name the concrete files, functions and commands involved, state the verification for the work, and call out risks or decisions the user should weigh.
- Do NOT use this tool to ask clarifying questions — use ask_user_question for that, before submitting.
- Do NOT call this for pure research or explanation tasks that involve no changes; just answer.

If the user approves, you receive the final plan (it may differ from yours — follow the approved text) and can start executing immediately. If they request changes, stay in plan mode, revise, and submit again.`;
