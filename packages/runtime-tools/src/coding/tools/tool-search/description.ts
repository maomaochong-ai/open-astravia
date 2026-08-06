export const TOOL_SEARCH_TOOL_DESCRIPTION = `Search the deferred MCP tool index by keyword and activate matching tools.

When many MCP tools are configured, most are not loaded into your tool list up front — only an index of names and one-line descriptions appears in the system prompt. Call this tool with keywords (tool name fragments, server name, or capability words like "page", "database", "issue") to activate the best matches; their full schemas are added to your tool list immediately and are callable on your very next step.

Guidance:
- Prefer keywords copied from the MCP tool index in the system prompt.
- When the user names a specific MCP server or tool, search for that name.
- Once a tool is reported as activated or already active, call that tool directly. Never re-run tool_search for the same tool — repeated searching makes no progress.
- Activation persists for the rest of the session; there is no need to re-search for tools already activated.
- If nothing matches, retry with broader or different keywords before telling the user the capability is unavailable.`;
