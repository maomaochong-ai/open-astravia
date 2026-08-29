import type {
	McpContent,
	McpInitializeResult,
	McpResourceContents,
	McpResourceReadResult,
	McpToolCallResult,
} from "./types.js";

/** Runtime validation for untrusted MCP wire results. Unknown extension fields are retained. */
export function isMcpToolCallResult(value: unknown): value is McpToolCallResult {
	if (!isRecord(value) || !Array.isArray(value.content) || !value.content.every(isMcpContent)) return false;
	return value.isError === undefined || typeof value.isError === "boolean";
}

export function isMcpResourceReadResult(value: unknown): value is McpResourceReadResult {
	return isRecord(value) && Array.isArray(value.contents) && value.contents.every(isMcpResourceContents);
}

export function isMcpInitializeResult(value: unknown): value is McpInitializeResult {
	if (!isRecord(value) || typeof value.protocolVersion !== "string" || !isRecord(value.serverInfo)) return false;
	return typeof value.serverInfo.name === "string" && typeof value.serverInfo.version === "string";
}

function isMcpContent(value: unknown): value is McpContent {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	if (value.type === "text") return typeof value.text === "string";
	if (value.type === "image" || value.type === "audio") {
		return typeof value.data === "string" && typeof value.mimeType === "string";
	}
	if (value.type === "resource_link") {
		return typeof value.uri === "string" && typeof value.name === "string";
	}
	if (value.type === "resource") return isMcpResourceContents(value.resource);
	return false;
}

function isMcpResourceContents(value: unknown): value is McpResourceContents {
	if (!isRecord(value) || typeof value.uri !== "string") return false;
	return (
		(typeof value.text === "string" && value.blob === undefined) ||
		(typeof value.blob === "string" && value.text === undefined)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
