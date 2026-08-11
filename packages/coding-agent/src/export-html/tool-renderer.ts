import type { ImageContent, TextContent } from "@vetta/ai";
import type { ToolDefinition } from "../extensions/index.js";
import type { Theme } from "../modes/interactive/theme/theme.js";
import { ansiLinesToHtml } from "./ansi-to-html.js";
import type { RenderableToolResultPart, ToolHtmlRenderer } from "./contracts.js";

export interface ToolHtmlRendererOptions {
	readonly getToolDefinition: (name: string) => ToolDefinition | undefined;
	readonly theme: Theme;
	readonly width?: number;
}

export function createToolHtmlRenderer(options: ToolHtmlRendererOptions): ToolHtmlRenderer {
	const { getToolDefinition, theme, width = 100 } = options;
	return {
		renderCall(toolName, args) {
			try {
				const definition = getToolDefinition(toolName);
				if (!definition?.renderCall) return undefined;
				return ansiLinesToHtml(definition.renderCall(args, theme).render(width));
			} catch {
				return undefined;
			}
		},
		renderResult(toolName, result, details, isError) {
			try {
				const definition = getToolDefinition(toolName);
				if (!definition?.renderResult) return undefined;
				const agentToolResult = {
					content: result as readonly RenderableToolResultPart[] as (TextContent | ImageContent)[],
					details,
					isError,
				};
				return ansiLinesToHtml(
					definition.renderResult(agentToolResult, { expanded: true, isPartial: false }, theme).render(width),
				);
			} catch {
				return undefined;
			}
		},
	};
}
