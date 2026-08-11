import type { McpRuntimeToolDescriptor } from "./runtime-tool-synchronizer.js";

export const DEFAULT_MCP_COMPACT_PROMPT_THRESHOLD = 15;

export function renderMcpToolsInstruction(tools: readonly McpRuntimeToolDescriptor[], deferred: boolean): string {
	return renderMcpToolsPromptSection(tools, { deferred });
}

export interface RenderMcpToolsPromptSectionOptions {
	readonly deferred: boolean;
	readonly markdown?: boolean;
	readonly compactThreshold?: number;
}

export function renderMcpToolsPromptSection(
	tools: readonly McpRuntimeToolDescriptor[],
	options: RenderMcpToolsPromptSectionOptions,
): string {
	if (tools.length === 0) return "";
	const compactThreshold = options.compactThreshold ?? DEFAULT_MCP_COMPACT_PROMPT_THRESHOLD;
	const compact = options.deferred && tools.length > compactThreshold;
	const toolsList = compact
		? renderServerIndex(tools, options.markdown === true)
		: renderToolIndex(tools, options.markdown === true);
	const usage = options.deferred
		? '**MCP tool usage (deferred)**: the list above is an INDEX — these tools are not loaded into your tool list yet. Before calling one, activate it via the `tool_search` tool (keyword search over this index); activated tools stay callable for the rest of the session. Tool names are prefixed with "mcp_[servername]_". When the user explicitly asks to use a specific MCP server or tool, search for it by name and use it instead of a built-in equivalent.'
		: '**MCP tool usage**: tool names are prefixed with "mcp_[servername]_" (e.g., mcp_filesystem_list_directory). When the user explicitly asks to use a specific MCP server or tool (e.g. "use filesystem MCP to list files"), you MUST use the corresponding MCP tool instead of a built-in equivalent.';
	const header = options.markdown
		? "# MCP (Model Context Protocol) Tools\n\nThe following MCP tools are available from external servers:"
		: "MCP (Model Context Protocol) tools:";
	return `${header}

${toolsList}

${usage}`;
}

function renderToolIndex(tools: readonly McpRuntimeToolDescriptor[], markdown: boolean): string {
	return tools
		.map((tool) =>
			markdown
				? `- **${tool.name}**: ${firstLine(tool.description)}`
				: `- ${tool.name}: ${firstLine(tool.description)}`,
		)
		.join("\n");
}

function renderServerIndex(tools: readonly McpRuntimeToolDescriptor[], markdown: boolean): string {
	const servers = new Map<string, string[]>();
	for (const tool of tools) {
		const { server, toolName } = splitMcpToolName(tool.name);
		const names = servers.get(server) ?? [];
		names.push(toolName);
		servers.set(server, names);
	}
	return [...servers.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([server, names]) => {
			const sample = names.slice(0, 3).join(", ");
			const label = markdown ? `**${server}**` : server;
			return `- ${label} (${names.length} tools): ${sample}${names.length > 3 ? ", ..." : ""}`;
		})
		.join("\n");
}

function splitMcpToolName(name: string): { readonly server: string; readonly toolName: string } {
	const match = /^mcp_([^_]+)_(.+)$/.exec(name);
	return match ? { server: match[1], toolName: match[2] } : { server: "other", toolName: name };
}

function firstLine(text: string): string {
	const line = text.split("\n", 1)[0]?.trim() ?? "";
	return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
