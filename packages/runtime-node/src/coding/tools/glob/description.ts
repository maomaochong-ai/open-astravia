export const GLOB_TOOL_DESCRIPTION = `Primary tool for matching file and directory paths by exact name or glob pattern. Returns paths relative to the search directory, respects .gitignore, and defaults to 100 results.

Use this for ordinary path searches such as "**/*.ts", "src/**/*.spec.ts", "src/**", or "package*.json". If the result is too broad, narrow the pattern or raise the limit. Do not also call \`find\` for the same search; \`find\` is a deferred high-volume fallback, not a second opinion.

Routing:
- Use \`glob\` for file or directory names and wildcard path patterns.
- Use \`grep\` for text or patterns inside file contents.
- Use \`dir_tree\` to inspect directory hierarchy.
- Use \`ls\` to list one directory's immediate children.
- Do not use shell commands such as find, fd, rg --files, or locate for path matching.`;
