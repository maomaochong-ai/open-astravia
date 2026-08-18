export const PROGRESS_TOOL_DESCRIPTION = `Announce the current stage of multi-step work so the user sees readable milestones instead of raw tool calls. This is presentation metadata only; it does not execute work or report evidence.

Use it for tasks that need multiple substantive tool calls or distinct phases, regardless of the user's technical level. Skip it for a single trivial lookup, a brief conversational answer, or a task with no tool calls.

How stages work (sliding window):
- One call does two things at once: \`summary\` closes and re-titles the stage you just finished,
  \`label\` opens the new stage you are starting now.
- Every tool call you make after a \`progress\` call belongs to that stage until the next
  \`progress\` call.
- Your final answer text implicitly closes the last stage, so you do not need a trailing
  \`progress\` call just to close it.

Workflow:
1. For a qualifying multi-step task, call progress(label="…") before the first work tool.
2. Do the work: read, search, extract, convert, whatever the stage needs.
3. When you move to a genuinely different stage, call
   progress(summary="<what the finished stage achieved>", label="<what you start now>").
4. Write the final answer. Do not call progress again afterwards.

Writing good titles:
- Write in the user's language. Keep each under 40 characters.
- \`label\` is present tense, what you are doing: "Reviewing the quarterly expense sheets".
- \`summary\` is past tense, what came out of it: "Reviewed 5 expense sheets".
- Describe the goal in the user's terms, not the mechanism. Say "Collecting last quarter's
  figures", not "Running grep and read".
- Do not number the stages. Do not repeat the same title twice in a row.

When to open a new stage:
- Open one whenever the purpose of your work changes, even if the tools are the same.
- 2 to 5 stages is typical for a real task. Do not open a stage per tool call.
- Do not create a stage per tool call, and do not use this tool merely because it is available.

Important:
- Tool calls that produce something the user must see (writing a file, generating a document,
  an image or a PDF, sending an attachment) should NOT be buried inside a stage. Close the
  current stage first, produce the artifact, then open the next stage if there is more work.
- This tool has no side effects and returns nothing useful. It exists purely so the user can
  follow along.`;
