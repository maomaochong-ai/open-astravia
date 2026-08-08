/**
 * Layer 1: Microcompact — lightweight context pruning.
 *
 * Clears old tool result / bash execution content and strips thinking blocks
 * from old assistant messages to reduce context size without calling the LLM.
 * Runs as a pure function on every LLM call via transformContext.
 */

import type { AgentMessage } from "@vetta/agent-core";
import type { AssistantMessage, ToolResultMessage } from "@vetta/ai";
import type { BashExecutionMessage } from "../model-context/index.js";

export interface MicrocompactOptions {
	/** Always keep the N most recent compactable results intact. */
	keepRecent: number;
	/** Only clear results older than this (ms). 0 = skip time check, prune by count only. */
	maxAgeMs: number;
	/** Disable count-based ToolResult pruning when a pressure-aware policy owns that responsibility. */
	pruneToolResults?: boolean;
}

export const DEFAULT_MICROCOMPACT_OPTIONS: MicrocompactOptions = {
	keepRecent: 8,
	maxAgeMs: 30 * 1000, // 30 seconds
};

const CLEARED_MESSAGE = "[tool result cleared — old context]";

/** Roles whose content can be pruned. */
const COMPACTABLE_ROLES = new Set(["toolResult", "bashExecution"]);

/**
 * Microcompact: prune old tool results, bash outputs, and thinking blocks.
 *
 * Algorithm:
 * 1. Prune tool results / bash outputs:
 *    a. Collect indices of compactable messages (toolResult / bashExecution).
 *    b. The last `keepRecent` are always protected.
 *    c. For unprotected messages, if `maxAgeMs > 0`, only clear those older
 *       than `now - maxAgeMs`. If `maxAgeMs === 0`, clear all unprotected.
 * 2. Prune thinking blocks from old assistant messages:
 *    a. Collect indices of assistant messages that contain thinking blocks.
 *    b. The last `keepRecent` are protected (same parameter).
 *    c. For unprotected: if thinking has a signature, keep signature but clear
 *       text (Anthropic can reconstruct from signature). Otherwise remove the
 *       thinking block entirely.
 * 3. Return a new array with cleared messages (shallow copy; only touched
 *    messages are new objects).
 */
export function microcompact(
	messages: AgentMessage[],
	options: MicrocompactOptions = DEFAULT_MICROCOMPACT_OPTIONS,
): AgentMessage[] {
	let result = messages;
	if (options.pruneToolResults !== false) result = pruneToolResults(result, options);
	result = pruneThinkingBlocks(result, options);
	return result;
}

/**
 * Prune old tool result and bash execution content.
 */
function pruneToolResults(messages: AgentMessage[], options: MicrocompactOptions): AgentMessage[] {
	const compactableIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		if (COMPACTABLE_ROLES.has(messages[i].role)) {
			compactableIndices.push(i);
		}
	}

	if (compactableIndices.length <= options.keepRecent) {
		return messages;
	}

	const clearCandidates = compactableIndices.slice(0, -options.keepRecent);
	const now = Date.now();
	const clearSet = new Set<number>();

	for (const idx of clearCandidates) {
		const msg = messages[idx];
		if (options.maxAgeMs > 0) {
			const ts = (msg as ToolResultMessage | BashExecutionMessage).timestamp;
			if (ts && now - ts >= options.maxAgeMs) {
				clearSet.add(idx);
			}
		} else {
			clearSet.add(idx);
		}
	}

	if (clearSet.size === 0) {
		return messages;
	}

	const result = new Array<AgentMessage>(messages.length);
	for (let i = 0; i < messages.length; i++) {
		if (!clearSet.has(i)) {
			result[i] = messages[i];
			continue;
		}

		const msg = messages[i];
		if (msg.role === "toolResult") {
			const tr = msg as ToolResultMessage;
			if (tr.content.length === 1 && tr.content[0].type === "text" && tr.content[0].text === CLEARED_MESSAGE) {
				result[i] = msg;
				continue;
			}
			result[i] = {
				...tr,
				content: [{ type: "text", text: CLEARED_MESSAGE }],
			};
		} else if (msg.role === "bashExecution") {
			const bash = msg as BashExecutionMessage;
			if (bash.output === CLEARED_MESSAGE) {
				result[i] = msg;
				continue;
			}
			result[i] = { ...bash, output: CLEARED_MESSAGE };
		} else {
			result[i] = msg;
		}
	}
	return result;
}

/**
 * Strip thinking blocks from old assistant messages.
 *
 * - With thinkingSignature (Anthropic): keep signature, clear text (API reconstructs)
 * - Without signature (other providers): remove thinking block entirely
 */
function pruneThinkingBlocks(messages: AgentMessage[], options: MicrocompactOptions): AgentMessage[] {
	// Collect indices of assistant messages that have thinking blocks
	const thinkingIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const asst = msg as AssistantMessage;
			if (asst.content.some((b) => b.type === "thinking")) {
				thinkingIndices.push(i);
			}
		}
	}

	if (thinkingIndices.length <= options.keepRecent) {
		return messages;
	}

	const clearCandidates = thinkingIndices.slice(0, -options.keepRecent);
	const now = Date.now();
	const clearSet = new Set<number>();

	for (const idx of clearCandidates) {
		const msg = messages[idx] as AssistantMessage;
		if (options.maxAgeMs > 0) {
			if (msg.timestamp && now - msg.timestamp >= options.maxAgeMs) {
				clearSet.add(idx);
			}
		} else {
			clearSet.add(idx);
		}
	}

	if (clearSet.size === 0) {
		return messages;
	}

	const result = new Array<AgentMessage>(messages.length);
	for (let i = 0; i < messages.length; i++) {
		if (!clearSet.has(i)) {
			result[i] = messages[i];
			continue;
		}

		const asst = messages[i] as AssistantMessage;
		const newContent: AssistantMessage["content"] = [];
		for (const block of asst.content) {
			if (block.type !== "thinking") {
				newContent.push(block);
				continue;
			}
			// Has signature: keep it, API can reconstruct thinking content
			if (block.thinkingSignature) {
				newContent.push({ ...block, thinking: "" });
			}
			// No signature: remove entirely
		}

		result[i] = { ...asst, content: newContent };
	}
	return result;
}
