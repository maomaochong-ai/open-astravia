import { Buffer } from "node:buffer";
import { join } from "node:path";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolResultContext, CodingToolResultPolicy } from "@vetta/runtime-tools/coding";
import { getAgentDir } from "../config.js";
import type { CodingToolResultArtifact, CodingToolResultArtifactStore } from "./contracts.js";
import { FileCodingToolResultArtifactStore } from "./file-result-artifact-store.js";

export const DEFAULT_CODING_AGENT_MAX_INLINE_TOOL_RESULT_BYTES = 50 * 1024;

export interface CodingAgentCodingToolResultPolicyOptions {
	readonly artifactStore?: CodingToolResultArtifactStore;
	readonly maxInlineResultBytes?: number;
	readonly agentDir?: string;
}

export function createCodingAgentCodingToolResultPolicy(
	options: CodingAgentCodingToolResultPolicyOptions | string = {},
): CodingToolResultPolicy {
	const resolvedOptions = typeof options === "string" ? { agentDir: options } : options;
	const maxInlineResultBytes = positiveInteger(
		resolvedOptions.maxInlineResultBytes,
		DEFAULT_CODING_AGENT_MAX_INLINE_TOOL_RESULT_BYTES,
	);
	const artifactStore =
		resolvedOptions.artifactStore ??
		new FileCodingToolResultArtifactStore(join(resolvedOptions.agentDir ?? getAgentDir(), "tool-results"));
	return {
		async project(result, context) {
			if (context.category === "external") return result;
			return projectLargeResult(result, context, artifactStore, maxInlineResultBytes);
		},
	};
}

async function projectLargeResult(
	result: RuntimeToolResult,
	context: CodingToolResultContext,
	artifactStore: CodingToolResultArtifactStore,
	maxInlineResultBytes: number,
): Promise<RuntimeToolResult> {
	const text = result.content
		.filter((item): item is Extract<(typeof result.content)[number], { type: "text" }> => item.type === "text")
		.map((item) => item.text)
		.join("\n\n");
	const textBytes = Buffer.byteLength(text, "utf8");
	const inlinePayloadBytes = measureInlinePayload(result);
	if (inlinePayloadBytes <= maxInlineResultBytes) return result;
	let serializedResult: string;
	try {
		serializedResult = JSON.stringify({
			content: result.content,
			...(result.details === undefined ? {} : { details: result.details }),
		});
	} catch {
		return result;
	}
	const resultBytes = Buffer.byteLength(serializedResult, "utf8");

	let artifact: CodingToolResultArtifact;
	try {
		artifact = await artifactStore.write({
			...context,
			mediaType: "application/json",
			data: serializedResult,
			byteLength: resultBytes,
		});
	} catch {
		return result;
	}

	const notice = `[Tool result exceeds inline budget (${inlinePayloadBytes} bytes). Full result: ${artifact.reference}]`;
	const projectedText = projectText(text, textBytes, maxInlineResultBytes, notice);
	return {
		content: [
			{ type: "text", text: projectedText },
			...result.content.filter(
				(item): item is Extract<(typeof result.content)[number], { type: "image" }> => item.type === "image",
			),
		],
		details: result.details,
	};
}

function measureInlinePayload(result: RuntimeToolResult): number {
	const contentBytes = result.content.reduce(
		(total, item) => total + (item.type === "text" ? Buffer.byteLength(item.text, "utf8") : 0),
		0,
	);
	if (result.details === undefined) return contentBytes;
	try {
		return contentBytes + Buffer.byteLength(JSON.stringify(result.details), "utf8");
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function projectText(text: string, textBytes: number, maxBytes: number, notice: string): string {
	if (textBytes <= maxBytes) return text.length > 0 ? `${text}\n\n${notice}` : notice;
	return `${sliceUtf8Start(text, Math.floor(maxBytes * 0.6))}\n\n${notice}\n\n${sliceUtf8End(
		text,
		Math.floor(maxBytes * 0.2),
	)}`;
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
