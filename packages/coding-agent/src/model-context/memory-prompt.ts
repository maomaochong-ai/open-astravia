const MEMORY_ENTRY_SEPARATOR = "\n\n§\n\n";

export function renderMemoryForPrompt(path: string, content: string, limit: number): string {
	const entries = content
		.split(MEMORY_ENTRY_SEPARATOR)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	const body =
		entries.length === 0
			? "(empty — no memories saved yet)"
			: entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
	const usage = `${content.length}/${limit} chars`;
	return (
		`# Persistent Memory\n\n` +
		`Durable, curated notes you have saved across conversations about the user, the ` +
		`project, ongoing work, and lessons learned. Stored in \`${path}\`.\n\n` +
		`This is a FROZEN SNAPSHOT captured at the start of this session — edits you make ` +
		`via the \`memory\` tool are written to disk immediately and the tool shows you the ` +
		`updated state, but they only re-enter this system prompt on the NEXT session. Use ` +
		`the \`memory\` tool (add / replace / remove) to keep this current: save durable ` +
		`facts and decisions, not transient chatter. Keep it under ${limit} chars by ` +
		`pruning stale entries.\n\n` +
		`<memory ${usage}>\n${body}\n</memory>`
	);
}
