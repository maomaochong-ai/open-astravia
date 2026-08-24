export const GLOB_TOOL_DESCRIPTION = `Primary tool for finding files by path pattern. Returns file paths relative to the search directory, most recently modified first, and defaults to 100 results.

Matching rules:
- Patterns are standard globs matched against the path relative to the search directory: \`**/*.ts\`, \`src/**/*.spec.ts\`, \`src/**\`, \`package*.json\`.
- \`**\` is required to cross directories — a bare \`*.ts\` matches only the top level, not the whole tree.
- Results are FILES only, never directories. Use \`dir_tree\` to inspect directory structure.
- Respects .gitignore (in a checkout or a plain directory) and includes hidden files; VCS metadata directories are excluded.
- When the limit is hit you get the most recently modified matches, so the page reflects what is currently in play. Raise \`limit\` or narrow the pattern for the rest.

Routing:
- Use \`glob\` for file paths by name or wildcard pattern.
- Use \`grep\` for text or patterns inside file contents.
- Use \`dir_tree\` to inspect directory hierarchy.
- Do not use shell commands such as find, fd, or \`rg --files\` for path matching.`;
