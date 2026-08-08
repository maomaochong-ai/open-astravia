import { Buffer } from "node:buffer";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { McpContent, McpToolCallResult } from "../protocol/index.js";

export const DEFAULT_MCP_MAX_INLINE_RESULT_BYTES = 20_000;

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
			const resultBytes = Buffer.byteLength(serializedResult, "utf8");
			if (resultBytes <= maxInlineResultBytes) return { content, details: result };

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
				return { content, details: result };
			}

			const text = content
				.filter((item): item is Extract<(typeof content)[number], { type: "text" }> => item.type === "text")
				.map((item) => item.text)
				.join("\n\n");
			const textBytes = Buffer.byteLength(text, "utf8");
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
			return { content: [{ type: "text", text: projectedText }, ...images], details };
		},
	};
}

export function preserveMcpToolResult(result: McpToolCallResult): RuntimeToolResult {
	return { content: convertMcpContent(result.content), details: result };
}

function convertMcpContent(mcpContent: readonly McpContent[]): RuntimeToolResult["content"] {
	const content: Array<RuntimeToolResult["content"][number]> = [];
	for (const item of mcpContent) {
		if (item.type === "text") {
			content.push({ type: "text", text: item.text });
		} else if (item.type === "image") {
			content.push({ type: "image", data: item.data, mimeType: item.mimeType });
		} else if (item.type === "resource") {
			const resource = item.resource;
			let text = `Resource: ${resource.uri}`;
			if (resource.text) {
				text += `\n${resource.text}`;
			} else if (resource.blob) {
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
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length <= maxBytes) return value;
	let end = maxBytes;
	while (end > 0 && isUtf8ContinuationByte(bytes[end])) end -= 1;
	return bytes.subarray(0, end).toString("utf8");
}

function sliceUtf8End(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length <= maxBytes) return value;
	let start = bytes.length - maxBytes;
	while (start < bytes.length && isUtf8ContinuationByte(bytes[start])) start += 1;
	return bytes.subarray(start).toString("utf8");
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
	return value !== undefined && (value & 0xc0) === 0x80;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}
