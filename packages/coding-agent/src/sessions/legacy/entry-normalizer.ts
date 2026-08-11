import { Value } from "@sinclair/typebox/value";
import type { AgentMessage } from "@vetta/agent-core";
import {
	CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE,
	CodingAgentExtendedMessageSchema,
	createCodingAgentCompactionSummaryMessage,
	isCodingAgentModelInvisibleCustomType,
	projectCodingAgentExtendedMessage,
	restoreCodingAgentSessionAgentMessageEntry,
} from "../projection/session-document-entry.js";

export const CODING_AGENT_LEGACY_AGENT_MESSAGE_CONTEXT_TYPE = CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE;
export { restoreCodingAgentSessionAgentMessageEntry };

/** Coding Agent-owned normalization policy for official JSONL v1-v3 entry variants. */
export function normalizeCodingAgentLegacySessionEntry(
	entry: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	if (entry.type === "message" && Value.Check(CodingAgentExtendedMessageSchema, entry.message)) {
		const { message, ...entryBase } = entry;
		return { ...entryBase, ...projectCodingAgentExtendedMessage(message as AgentMessage) };
	}
	if (
		entry.type === "custom_message" &&
		typeof entry.customType === "string" &&
		typeof entry.modelVisible !== "boolean"
	) {
		return {
			...entry,
			modelVisible: !isCodingAgentModelInvisibleCustomType(entry.customType),
		};
	}
	if (entry.type === "compaction" && typeof entry.summary === "string" && entry.summaryMessage === undefined) {
		const timestamp = new Date(String(entry.timestamp)).getTime();
		if (!Number.isFinite(timestamp)) return entry;
		return {
			...entry,
			summaryMessage: createCodingAgentCompactionSummaryMessage(entry.summary, timestamp),
		};
	}
	return entry;
}
