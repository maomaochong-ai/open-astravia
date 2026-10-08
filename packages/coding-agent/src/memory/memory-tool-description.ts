import { MEMORY_SCOPE_GUIDANCE } from "./memory-scope.js";

/** 作用域措辞与系统提示词同源，避免两处描述漂移。 */
const MEMORY_SCOPE_LINES = [
	`- user — ${MEMORY_SCOPE_GUIDANCE.user}`,
	`- project — ${MEMORY_SCOPE_GUIDANCE.project}`,
].join("\n");

export const MEMORY_TOOL_DESCRIPTION = `Save or update durable, cross-session memory.

Memory is frozen into your system prompt at the start of each session. It is how you remember things across separate conversations: who the user is, their preferences and environment, the ongoing projects and goals, important decisions, and lessons learned. Without it, every new session starts from zero.

Scopes:
${MEMORY_SCOPE_LINES}

Pass \`scope\` to choose where a write lands; it defaults to \`user\` when the session has user-level memory, otherwise \`project\`. Each scope keeps its own entries, so \`match\` only searches the scope you are writing to.

Actions:
- add — append a new memory entry. Provide \`content\` (one self-contained fact per entry).
- replace — swap an existing entry. Provide \`match\` (a substring identifying the entry) and \`content\` (the new text).
- remove — delete an entry. Provide \`match\`.

When to save: durable facts and decisions that future sessions should know — not transient chatter, not things already obvious from the files. Prefer a few high-signal entries over many noisy ones.

Important:
- Writes are persisted to disk immediately and this tool returns the updated state, so you can see your own writes this turn.
- But the system-prompt snapshot does NOT change mid-session — your edits re-enter the prompt only on the next session. This is intentional (it preserves the prompt cache).
- Each scope has its own character budget. If a write would exceed it, the tool errors and you must remove or shorten an entry first. Keep memory curated and concise.`;
