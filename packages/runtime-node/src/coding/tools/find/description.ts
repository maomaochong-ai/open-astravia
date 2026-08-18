export const FIND_TOOL_DESCRIPTION = `Deferred high-volume path matching by glob pattern. Returns matching file and directory paths relative to the search directory, respects .gitignore, and defaults to 1000 results.

Use this tool only when it has been explicitly activated and you intentionally need a large path result set, such as continuing an inventory after the primary \`glob\` tool reached its practical limit. For ordinary file or directory name matching, use \`glob\` instead; do not call both tools for the same search.

Routing:
- Use \`glob\` for normal file or directory path matching by exact name or wildcard pattern.
- Use \`find\` only as the high-volume fallback described above.
- Use \`grep\` for text or patterns inside file contents.
- Use \`dir_tree\` to inspect directory hierarchy.
- Use \`ls\` to list one directory's immediate children.
- Do not use shell commands such as find, fd, rg --files, or locate for these path searches.`;
