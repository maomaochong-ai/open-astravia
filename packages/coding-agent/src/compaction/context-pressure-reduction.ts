import { Buffer } from "node:buffer";
import type { AgentMessage } from "@vetta/agent-core";
import type { ToolResultMessage } from "@vetta/ai";
import type { BashExecutionMessage } from "../model-context/index.js";
import { findRecentMatchingUserTurnBoundary } from "./user-turn-boundary.js";

export const DEFAULT_CONTEXT_REDUCTION_SOFT_PRESSURE = 0.5;
export const DEFAULT_CONTEXT_REDUCTION_HARD_PRESSURE = 0.75;
export const DEFAULT_PROTECTED_USER_TURNS = 3;
export const DEFAULT_HARD_CLEAR_USER_TURN_AGE = 10;
export const DEFAULT_SOFT_TOOL_RESULT_BYTES = 8 * 1024;

const CLEARED_MESSAGE = "[tool result cleared — context pressure]";

export interface ContextPressureReductionOptions {
	readonly contextWindow: number;
	readonly estimatedTokens: number;
	readonly softPressure?: number;
	readonly hardPressure?: number;
	readonly protectedUserTurns?: number;
	readonly hardClearUserTurnAge?: number;
	readonly softToolResultBytes?: number;
	readonly isRealUserTurn?: (message: AgentMessage, index: number) => boolean;
}

/** Transient ToolResult projection. It never mutates the persisted message objects. */
export function reduceContextByPressure(
	messages: readonly AgentMessage[],
	options: ContextPressureReductionOptions,
): AgentMessage[] {
	const pressure = options.contextWindow > 0 ? options.estimatedTokens / options.contextWindow : 0;
	const softPressure = ratio(options.softPressure, DEFAULT_CONTEXT_REDUCTION_SOFT_PRESSURE);
	const hardPressure = ratio(options.hardPressure, DEFAULT_CONTEXT_REDUCTION_HARD_PRESSURE);
	if (pressure < softPressure) return [...messages];

	const protectedUserTurns = nonNegativeInteger(options.protectedUserTurns, DEFAULT_PROTECTED_USER_TURNS);
	const isRealUserTurn = options.isRealUserTurn ?? ((message: AgentMessage) => message.role === "user");
	const protectedFromIndex = findRecentMatchingUserTurnBoundary(messages, protectedUserTurns, isRealUserTurn);
	const hardClearUserTurnAge = positiveInteger(options.hardClearUserTurnAge, DEFAULT_HARD_CLEAR_USER_TURN_AGE);
	const hardClearFromIndex = findRecentMatchingUserTurnBoundary(messages, hardClearUserTurnAge, isRealUserTurn);
	const softToolResultBytes = positiveInteger(options.softToolResultBytes, DEFAULT_SOFT_TOOL_RESULT_BYTES);
	const hard = pressure >= Math.max(softPressure, hardPressure);
	let changed = false;
	const result = messages.map((message, index) => {
		if (index >= protectedFromIndex) return message;
		if (message.role === "toolResult") {
			const projected =
				hard && index < hardClearFromIndex
					? clearToolResult(message as ToolResultMessage)
					: truncateToolResult(message as ToolResultMessage, softToolResultBytes);
			changed ||= projected !== message;
			return projected;
		}
		if (message.role === "bashExecution") {
			const projected =
				hard && index < hardClearFromIndex
					? clearBashResult(message as BashExecutionMessage)
					: truncateBashResult(message as BashExecutionMessage, softToolResultBytes);
			changed ||= projected !== message;
			return projected;
		}
		return message;
	});
	return changed ? result : [...messages];
}

function truncateToolResult(message: ToolResultMessage, maxBytes: number): ToolResultMessage {
	const text = message.content
		.filter((item): item is Extract<(typeof message.content)[number], { type: "text" }> => item.type === "text")
		.map((item) => item.text)
		.join("\n\n");
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return message;
	const images = message.content.filter(
		(item): item is Extract<(typeof message.content)[number], { type: "image" }> => item.type === "image",
	);
	return {
		...message,
		content: [{ type: "text", text: truncateText(text, maxBytes) }, ...images],
	};
}

function clearToolResult(message: ToolResultMessage): ToolResultMessage {
	if (
		message.content.length === 1 &&
		message.content[0]?.type === "text" &&
		message.content[0].text === CLEARED_MESSAGE
	) {
		return message;
	}
	return { ...message, content: [{ type: "text", text: CLEARED_MESSAGE }] };
}

function truncateBashResult(message: BashExecutionMessage, maxBytes: number): BashExecutionMessage {
	if (Buffer.byteLength(message.output, "utf8") <= maxBytes) return message;
	return { ...message, output: truncateText(message.output, maxBytes) };
}

function clearBashResult(message: BashExecutionMessage): BashExecutionMessage {
	return message.output === CLEARED_MESSAGE ? message : { ...message, output: CLEARED_MESSAGE };
}

function truncateText(value: string, maxBytes: number): string {
	const notice = "\n...[tool result shortened by context pressure]...\n";
	const noticeBytes = Buffer.byteLength(notice, "utf8");
	const available = Math.max(2, maxBytes - noticeBytes);
	return `${sliceUtf8Start(value, Math.floor(available * 0.7))}${notice}${sliceUtf8End(
		value,
		Math.floor(available * 0.3),
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

function ratio(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback;
}
