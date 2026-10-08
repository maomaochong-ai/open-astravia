import type { CodingAgentMemoryScopeSnapshot } from "../memory/memory-runtime-contract.js";
import { MEMORY_SCOPE_GUIDANCE } from "../memory/memory-scope.js";

const MEMORY_ENTRY_SEPARATOR = "\n\n§\n\n";

function renderScopeSection(scope: CodingAgentMemoryScopeSnapshot, limit: number): string {
	const entries = scope.snapshot
		.split(MEMORY_ENTRY_SEPARATOR)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	const body =
		entries.length === 0
			? "(empty — no memories saved yet)"
			: entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
	const usage = `${scope.snapshot.length}/${limit} chars`;
	return `<memory scope="${scope.scope}" path="${scope.file}" ${usage}>\n${body}\n</memory>`;
}

/**
 * 按作用域渲染记忆块。调用方负责顺序（`user` → `project`），与提示词中的说明一致。
 */
export function renderMemoryForPrompt(scopes: readonly CodingAgentMemoryScopeSnapshot[], limit: number): string {
	const scopeLines = scopes
		.map((scope) => `- \`${scope.scope}\` — ${MEMORY_SCOPE_GUIDANCE[scope.scope]} Stored in \`${scope.file}\`.`)
		.join("\n");
	const sections = scopes.map((scope) => renderScopeSection(scope, limit)).join("\n\n");
	return (
		`# Persistent Memory\n\n` +
		`Durable, curated notes you have saved across conversations about the user, the ` +
		`project, ongoing work, and lessons learned.\n\n` +
		`Scopes:\n${scopeLines}\n\n` +
		`This is a FROZEN SNAPSHOT captured at the start of this session — edits you make ` +
		`via the \`memory\` tool are written to disk immediately and the tool shows you the ` +
		`updated state, but they only re-enter this system prompt on the NEXT session. Use ` +
		`the \`memory\` tool (add / replace / remove) to keep this current: save durable ` +
		`facts and decisions, not transient chatter. Keep each scope under ${limit} chars by ` +
		`pruning stale entries.\n\n` +
		sections
	);
}
