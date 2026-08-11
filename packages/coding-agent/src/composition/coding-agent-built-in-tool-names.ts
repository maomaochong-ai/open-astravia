/**
 * 产品级内置 Tool 激活名称。
 *
 * Tool 定义和执行归 runtime-tools；这里仅保留 CLI/SDK 对外参数的稳定名称集合。
 * Extension/MCP 等动态 Tool 仍由运行期 Catalog 注册，不进入这个闭合集合。
 */
export const CODING_AGENT_BUILT_IN_TOOL_NAMES = [
	"read",
	"bash",
	"shell",
	"edit",
	"write",
	"grep",
	"glob",
	"find",
	"ls",
	"dir_tree",
	"doc_to_pdf",
	"html_to_pdf",
	"extract_text_from_pdf",
	"extract_text_from_img",
	"render_pdf_page",
	"current_time",
	"progress",
	"kb_write_page",
	"kb_filter_by_tags",
	"kb_list_available_tags",
] as const;

export type CodingAgentBuiltInToolName = (typeof CODING_AGENT_BUILT_IN_TOOL_NAMES)[number];

const CODING_AGENT_BUILT_IN_TOOL_NAME_SET: ReadonlySet<string> = new Set(CODING_AGENT_BUILT_IN_TOOL_NAMES);

export function isCodingAgentBuiltInToolName(name: string): name is CodingAgentBuiltInToolName {
	return CODING_AGENT_BUILT_IN_TOOL_NAME_SET.has(name);
}
