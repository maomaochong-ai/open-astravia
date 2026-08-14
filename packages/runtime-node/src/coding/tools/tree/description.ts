export const TREE_TOOL_DESCRIPTION = `Render a compact directory tree for a path, with explicit node types and counts:
- [D] for directories (with immediate child counts: d:<dirs>, f:<files>)
- [F] for files
- Each rendered node also includes a stable path ID like \`id=@PATH_0001\`

ALWAYS use this tool (not bash \`tree\` or \`find\`) when you need a directory structure overview.
Use path IDs directly as tool path arguments to avoid filename mutation by the model.

When to use \`dir_tree\` vs other tools:
- Use \`dir_tree\` FIRST when you need a high-level map of a codebase with minimal token usage, then drill down with \`read\`/\`find\`/\`grep\`
- Use \`ls\` for simple flat listing of one directory
- Use \`find\` to search for specific file name patterns
- NEVER use bash commands (tree, find, ls -R) for directory structure — always use this tool

Performance and safety:
- Uses fd for fast cross-platform scanning (macOS/Linux/Windows)
- Respects .gitignore by default
- Supports maxDepth and node limits to avoid context explosion
- Truncates output when size limits are hit`;
