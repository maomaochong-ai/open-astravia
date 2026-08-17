export const FIND_TOOL_DESCRIPTION = `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to 1000 results or 30KB (whichever is hit first).

ALWAYS use this tool for file name search. NEVER use bash find, fd, or locate — this tool is faster, respects .gitignore, and has consistent output formatting.

When to use \`find\` vs other tools:
- Use \`find\` to search for files BY NAME or glob pattern (e.g., "*.ts", "config.*", "**/*.test.js")
- Use \`grep\` to search for text/patterns INSIDE file contents
- Use \`dir_tree\` to visualize directory structure with hierarchy
- Use \`ls\` to list immediate contents of a single directory`;
