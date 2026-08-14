export const GREP_TOOL_DESCRIPTION = `Search file contents for a pattern. Returns matching lines as \`path:line:hash: content\` — the \`line:hash\` part is an anchor usable directly in the \`edit\` tool's anchor mode. Respects .gitignore. Output is truncated to 100 matches or 30KB (whichever is hit first). Long lines are truncated to 2000 chars.

ALWAYS use this tool for content search. NEVER use bash grep, rg, ag, or ack — this tool is faster, respects .gitignore, and provides better formatted output.

When to use \`grep\` vs other tools:
- Use \`grep\` to search for text/patterns INSIDE files (function names, variable references, error messages, etc.)
- Use \`find\` to search for files BY NAME or glob pattern (e.g., "*.ts", "config.*")
- Use \`dir_tree\` to get a high-level overview of directory structure
- For complex multi-round searches that may need several attempts, consider delegating to a subagent`;
