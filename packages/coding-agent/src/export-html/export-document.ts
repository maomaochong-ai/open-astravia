import type { ConversationDocument } from "@vetta/runtime-core";
import type { ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import { CODING_AGENT_SESSION_VIEW_VERSION } from "../sessions/index.js";
import type {
	HtmlExportOptions,
	LegacySessionExportDocument,
	RenderableToolResultPart,
	ToolHtmlRenderer,
} from "./contracts.js";

export interface RenderedToolHtml {
	readonly callHtml?: string;
	readonly resultHtml?: string;
}

export interface HtmlExportDocument {
	readonly header: unknown;
	readonly entries: readonly unknown[];
	readonly leafId: string | null;
	readonly systemPrompt?: string;
	readonly tools?: readonly {
		readonly name: string;
		readonly description: string;
		readonly parameters: unknown;
	}[];
	readonly renderedTools?: Readonly<Record<string, RenderedToolHtml>>;
}

export function projectLegacyHtmlExportDocument(document: LegacySessionExportDocument): HtmlExportDocument {
	return {
		header: document.header,
		entries: document.entries,
		leafId: document.activeLeafId,
	};
}

export function projectConversationHtmlExportDocument(
	document: ConversationDocument,
	options: HtmlExportOptions,
): HtmlExportDocument {
	return {
		header: {
			type: "session",
			version: CODING_AGENT_SESSION_VIEW_VERSION,
			id: document.identity.sessionId,
			timestamp: new Date(document.identity.createdAt).toISOString(),
			cwd: document.identity.cwd,
			parentSession: document.identity.parentSessionPath,
			name: document.name,
		},
		entries: document.entries,
		leafId: document.activeLeafId,
		systemPrompt: options.systemPrompt,
		tools: options.tools ? [...options.tools] : undefined,
		renderedTools: options.toolRenderer ? preRenderCustomTools(document.entries, options.toolRenderer) : undefined,
	};
}

const BUILTIN_TOOLS = new Set([
	"bash",
	"read",
	"write",
	"edit",
	"ls",
	"find",
	"grep",
	"dir_tree",
	"tree",
	"kb_write_page",
	"kb_filter_by_tags",
	"kb_list_available_tags",
]);

function preRenderCustomTools(
	entries: readonly ConversationDocumentEntry[],
	toolRenderer: ToolHtmlRenderer,
): Readonly<Record<string, RenderedToolHtml>> {
	const renderedTools: Record<string, RenderedToolHtml> = {};
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!isRecord(message)) continue;
		const content = Reflect.get(message, "content");
		if (Reflect.get(message, "role") === "assistant" && Array.isArray(content)) {
			for (const block of content) {
				if (!isRecord(block)) continue;
				const toolName = Reflect.get(block, "name");
				const toolCallId = Reflect.get(block, "id");
				if (
					Reflect.get(block, "type") !== "toolCall" ||
					typeof toolName !== "string" ||
					typeof toolCallId !== "string" ||
					BUILTIN_TOOLS.has(toolName)
				) {
					continue;
				}
				const callHtml = toolRenderer.renderCall(toolName, Reflect.get(block, "arguments"));
				if (callHtml) renderedTools[toolCallId] = { callHtml };
			}
		}

		const toolCallId = Reflect.get(message, "toolCallId");
		if (Reflect.get(message, "role") !== "toolResult" || typeof toolCallId !== "string") continue;
		const rawToolName = Reflect.get(message, "toolName");
		const toolName = typeof rawToolName === "string" ? rawToolName : "";
		const existing = renderedTools[toolCallId];
		if (!existing && BUILTIN_TOOLS.has(toolName)) continue;
		const resultHtml = toolRenderer.renderResult(
			toolName,
			readRenderableToolResultContent(content),
			Reflect.get(message, "details"),
			Reflect.get(message, "isError") === true,
		);
		if (resultHtml) renderedTools[toolCallId] = { ...existing, resultHtml };
	}
	return renderedTools;
}

function readRenderableToolResultContent(value: unknown): readonly RenderableToolResultPart[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((part) => {
		if (!isRecord(part)) return [];
		const type = Reflect.get(part, "type");
		if (typeof type !== "string") return [];
		const text = Reflect.get(part, "text");
		const data = Reflect.get(part, "data");
		const mimeType = Reflect.get(part, "mimeType");
		return [
			{
				type,
				...(typeof text === "string" ? { text } : {}),
				...(typeof data === "string" ? { data } : {}),
				...(typeof mimeType === "string" ? { mimeType } : {}),
			},
		];
	});
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
