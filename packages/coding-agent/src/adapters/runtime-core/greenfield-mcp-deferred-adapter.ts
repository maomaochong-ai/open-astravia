import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	createToolSearchTool,
	type DeferredToolIndexEntry,
	scoreDeferredTools,
	type ToolSearchResult,
} from "@vetta/runtime-tools/coding";
import { renderMcpToolsSection } from "../../model-context/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";

export interface CodingAgentDeferredMcpTool {
	readonly name: string;
	readonly description: string;
}

export function renderCodingAgentMcpToolsInstruction(
	tools: readonly CodingAgentDeferredMcpTool[],
	deferred: boolean,
): string {
	return renderMcpToolsSection(
		tools.map(({ name, description }) => ({ name, description })),
		false,
		deferred,
	);
}

export function scoreCodingAgentDeferredMcpTools(
	query: string,
	tools: readonly CodingAgentDeferredMcpTool[],
): readonly CodingAgentDeferredMcpTool[] {
	return scoreDeferredTools(query, tools.map(toDeferredToolIndexEntry));
}

export function createCodingAgentToolSearchRuntimeTool(
	search: (query: string, maxResults: number) => ToolSearchResult,
): RuntimeToolDefinition {
	return {
		...createToolSearchTool({ search }),
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.toolSearch,
	};
}

function toDeferredToolIndexEntry(tool: CodingAgentDeferredMcpTool): DeferredToolIndexEntry {
	return { name: tool.name, description: tool.description };
}
