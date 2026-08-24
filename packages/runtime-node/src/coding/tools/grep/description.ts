export const GREP_TOOL_DESCRIPTION = `Search file contents for a pattern. Returns matching lines as \`path:line:hash: content\` — the \`line:hash\` part is an anchor usable directly in the \`edit\` tool's anchor mode. Respects .gitignore. Output is truncated to 100 matches or 30KB (whichever is hit first). Long lines are truncated to 500 chars.

ALWAYS use this tool for content search. NEVER use bash grep, rg, ag, or ack — this tool is faster, respects .gitignore, and provides better formatted output.

Writing the pattern:
- The pattern is a regex, so escape literal special characters: \`functionCall\\(\`, or \`interface\\{\\}\` to find Go's interface{}. Set \`literal: true\` to skip escaping entirely.
- Only filter by \`glob\` when you are sure of the file extension — an import path does not have to match the source file's type (a \`.js\` specifier often resolves to a \`.ts\` file), so filtering can silently hide the matches you want.
- Use \`filesOnly: true\` when you only need which files mention something; it returns paths without the matching lines, which is far cheaper for a broad term.
- Use \`context\` to see surrounding lines instead of re-reading each file.

When to use \`grep\` vs other tools:
- Use \`grep\` to search for text/patterns INSIDE files (function names, variable references, error messages, etc.)
- Use \`glob\` to find files BY PATH or name pattern (e.g., "**/*.ts", "package*.json")
- Use \`dir_tree\` to get a high-level overview of directory structure
- For complex multi-round searches that may need several attempts, consider delegating to a subagent`;
