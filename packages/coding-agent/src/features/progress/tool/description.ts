export const PROGRESS_TOOL_DESCRIPTION = `Announce what you are about to do next, so the user sees readable stages instead of raw tool calls.

The user you are talking to is NOT a developer. They should never have to read a wall of file
reads, greps and shell commands. Instead, they see a short list of stages you narrate with this
tool, each collapsing all the tool calls you made inside it.

How stages work (sliding window):
- One call does two things at once: \`summary\` closes and re-titles the stage you just finished,
  \`label\` opens the new stage you are starting now.
- Every tool call you make after a \`progress\` call belongs to that stage until the next
  \`progress\` call.
- Your final answer text implicitly closes the last stage, so you do not need a trailing
  \`progress\` call just to close it.

Workflow:
1. Call progress(label="…") BEFORE your first tool call of a task.
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
- For a single trivial lookup answered in one tool call, skip this tool entirely.

Important:
- Tool calls that produce something the user must see (writing a file, generating a document,
  an image or a PDF, sending an attachment) should NOT be buried inside a stage. Close the
  current stage first, produce the artifact, then open the next stage if there is more work.
- This tool has no side effects and returns nothing useful. It exists purely so the user can
  follow along.`;
