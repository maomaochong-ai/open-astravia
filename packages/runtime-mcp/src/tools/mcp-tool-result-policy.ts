import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { McpContent, McpToolCallResult } from "../protocol/index.js";

export const DEFAULT_MCP_MAX_INLINE_RESULT_BYTES = 20_000;
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export interface McpToolResultArtifactWriteRequest {
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly serverName: string;
	readonly toolName: string;
	readonly mediaType: "application/json";
	readonly data: string;
	readonly byteLength: number;
}

export interface McpToolResultArtifact {
	readonly reference: string;
}

export interface McpToolResultArtifactStore {
	write(request: McpToolResultArtifactWriteRequest): Promise<McpToolResultArtifact>;
}

export interface McpToolResultContext {
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly serverName: string;
	readonly toolName: string;
}

export interface McpToolResultOffloadDetails {
	readonly isError?: boolean;
	readonly offloaded: true;
	readonly textTruncated: boolean;
	readonly artifact: McpToolResultArtifact & {
		readonly mediaType: "application/json";
		readonly byteLength: number;
	};
	readonly summary: {
		readonly contentItems: number;
		readonly textBytes: number;
		readonly imageCount: number;
		readonly resourceCount: number;
	};
}

export interface McpToolResultPolicy {
	project(result: McpToolCallResult, context: McpToolResultContext): Promise<RuntimeToolResult>;
}

export const PRESERVE_MCP_TOOL_RESULT_POLICY: McpToolResultPolicy = Object.freeze({
	async project(result: McpToolCallResult) {
		return preserveMcpToolResult(result);
	},
});

export interface McpToolResultPolicyOptions {
	readonly artifactStore: McpToolResultArtifactStore;
	readonly maxInlineResultBytes?: number;
}

export function createMcpToolResultPolicy(options: McpToolResultPolicyOptions): McpToolResultPolicy {
	const maxInlineResultBytes = positiveInteger(options.maxInlineResultBytes, DEFAULT_MCP_MAX_INLINE_RESULT_BYTES);
	return {
		async project(result, context) {
			const content = convertMcpContent(result.content);
			const serializedResult = JSON.stringify(result);
			const resultBytes = utf8ByteLength(serializedResult);
			if (resultBytes <= maxInlineResultBytes) return projectResult(content, result, result);

			let artifact: McpToolResultArtifact;
			try {
				artifact = await options.artifactStore.write({
					...context,
					mediaType: "application/json",
					data: serializedResult,
					byteLength: resultBytes,
				});
			} catch {
				// Never discard the only copy of a tool result when auxiliary storage fails.
				return projectResult(content, result, result);
			}

			const text = content
				.filter((item): item is Extract<(typeof content)[number], { type: "text" }> => item.type === "text")
				.map((item) => item.text)
				.join("\n\n");
			const textBytes = utf8ByteLength(text);
			const textTruncated = textBytes > maxInlineResultBytes;
			const notice = renderOffloadNotice(artifact.reference, resultBytes, textTruncated);
			const projectedText = textTruncated
				? `${sliceUtf8Start(text, Math.floor(maxInlineResultBytes * 0.6))}\n\n${notice}\n\n${sliceUtf8End(
						text,
						Math.floor(maxInlineResultBytes * 0.2),
					)}`
				: `${text}${text ? "\n\n" : ""}${notice}`;
			const images = content.filter(
				(item): item is Extract<(typeof content)[number], { type: "image" }> => item.type === "image",
			);
			const details: McpToolResultOffloadDetails = {
				...(result.isError === undefined ? {} : { isError: result.isError }),
				offloaded: true,
				textTruncated,
				artifact: {
					...artifact,
					mediaType: "application/json",
					byteLength: resultBytes,
				},
				summary: summarizeContent(result.content, textBytes),
			};
			return projectResult([{ type: "text", text: projectedText }, ...images], details, result);
		},
	};
}

export function preserveMcpToolResult(result: McpToolCallResult): RuntimeToolResult {
	return projectResult(convertMcpContent(result.content), result, result);
}

function projectResult(
	content: RuntimeToolResult["content"],
	details: unknown,
	result: Pick<McpToolCallResult, "isError">,
): RuntimeToolResult {
	return {
		content,
		details,
		...(result.isError === undefined ? {} : { isError: result.isError }),
	};
}

function convertMcpContent(mcpContent: readonly McpContent[]): RuntimeToolResult["content"] {
	const content: Array<RuntimeToolResult["content"][number]> = [];
	for (const item of mcpContent) {
		if (item.type === "text") {
			content.push({ type: "text", text: item.text });
		} else if (item.type === "image") {
			content.push({ type: "image", data: item.data, mimeType: item.mimeType });
		} else if (item.type === "audio") {
			content.push({ type: "text", text: `Audio content: ${item.mimeType}` });
		} else if (item.type === "resource_link") {
			const description = item.description ? `\n${item.description}` : "";
			content.push({ type: "text", text: `Resource link: ${item.name} (${item.uri})${description}` });
		} else if (item.type === "resource") {
			const resource = item.resource;
			let text = `Resource: ${resource.uri}`;
			if ("text" in resource) {
				text += `\n${resource.text}`;
			} else if (resource.mimeType?.startsWith("image/") && resource.blob) {
				content.push({ type: "image", data: resource.blob, mimeType: resource.mimeType });
				continue;
			} else if ("blob" in resource) {
				text += `\n[Binary data: ${resource.mimeType || "unknown"}]`;
			}
			content.push({ type: "text", text });
		}
	}
	return content;
}

function renderOffloadNotice(reference: string, byteLength: number, textTruncated: boolean): string {
	const action = textTruncated ? "truncated and saved" : "saved";
	return `[MCP result ${action} (${byteLength} bytes). Full result: ${reference}]`;
}

function summarizeContent(content: readonly McpContent[], textBytes: number): McpToolResultOffloadDetails["summary"] {
	return {
		contentItems: content.length,
		textBytes,
		imageCount: content.filter((item) => item.type === "image").length,
		resourceCount: content.filter((item) => item.type === "resource").length,
	};
}

function sliceUtf8Start(value: string, maxBytes: number): string {
	const bytes = utf8Encoder.encode(value);
	if (bytes.length <= maxBytes) return value;
	let end = maxBytes;
	while (end > 0 && isUtf8ContinuationByte(bytes[end])) end -= 1;
	return utf8Decoder.decode(bytes.subarray(0, end));
}

function sliceUtf8End(value: string, maxBytes: number): string {
	const bytes = utf8Encoder.encode(value);
	if (bytes.length <= maxBytes) return value;
	let start = bytes.length - maxBytes;
	while (start < bytes.length && isUtf8ContinuationByte(bytes[start])) start += 1;
	return utf8Decoder.decode(bytes.subarray(start));
}

function utf8ByteLength(value: string): number {
	return utf8Encoder.encode(value).length;
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
	return value !== undefined && (value & 0xc0) === 0x80;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}
