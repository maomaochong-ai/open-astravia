export const GLOB_TOOL_DESCRIPTION = `Fast file and directory pattern matching by glob pattern. Returns matching paths relative to the search directory. Respects .gitignore. Output is truncated to 100 results or 30KB (whichever is hit first).

ALWAYS use this tool for file or directory name glob searches. NEVER use bash find, fd, rg --files, or locate for this task - this tool respects .gitignore and has consistent output formatting.

When to use \`glob\` vs other tools:
- Use \`glob\` to find files or directories BY NAME or wildcard pattern (e.g., "**/*.ts", "src/**/*.spec.ts", "src/**", "package*.json")
- Use \`grep\` to search for text/patterns INSIDE file contents
- Use \`dir_tree\` to visualize directory structure with hierarchy
- Use \`ls\` to list immediate contents of a single directory`;
