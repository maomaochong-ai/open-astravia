export const TODO_TOOL_DESCRIPTION = `Manage a todo list to plan and track progress on multi-step tasks.

When to create a todo plan:
- Task requires 3 or more distinct steps
- User asks to modify multiple files
- Task involves sequential work (step A must finish before step B)
- User explicitly asks for a plan ("plan", "todo", "step by step", "分步", "计划", "列个清单")

When NOT to create:
- Single file edit or simple question
- Task completable in 1-2 trivial steps
- Purely informational or conversational request

Workflow:
1. If a todo list may already exist, call todo(action="list") before creating a new plan.
2. Call todo(action="create") with all planned steps BEFORE starting any work, but only when the list is empty.
3. Call todo(action="update", id=N, status="in_progress") when you START a step.
4. Call todo(action="update", id=N, status="done") when you FINISH a step.
5. Update status in real time — do not batch updates.
6. Prefer completing items in order, but you MAY reprioritize or update out of order when it makes sense.
7. If the user changes direction and the current plan no longer applies, call todo(action="clear") to abandon it, then create a fresh plan.

Never call create to start a new plan when a todo list already exists. Create does not append a new plan to an existing plan: it will be rejected. First call list, then either continue the existing plan or clear it if obsolete.

Aim to finish the items you committed to — don't abandon a plan halfway without reason. If the user has redirected you, clear the stale plan rather than ignoring it.

NOTE — locked lists are STRICT: lists created from a scene's tasks.json are locked. For a locked list you MUST complete items in strict sequential order by ID, you CANNOT create or clear items, and you MUST finish every item before stopping. Out-of-order updates and clear are REJECTED, and the system will force you to continue if you stop early.`;
