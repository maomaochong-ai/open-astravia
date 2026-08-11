import { isDeepStrictEqual } from "node:util";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { AgentMessage } from "@vetta/agent-core";
import type {
	ConversationDocumentCustomMessageEntry,
	ConversationDocumentEntry,
} from "@vetta/runtime-core/conversation";
import {
	COMPACTION_SUMMARY_PREFIX,
	COMPACTION_SUMMARY_SUFFIX,
	convertToLlm,
	PROMPT_ATTACHMENT_REFERENCE_TYPE,
	PROMPT_RESOURCE_REFERENCE_TYPE,
} from "../../model-context/index.js";
import type { CodingAgentSessionEntry, CodingAgentSessionMessageEntry } from "../contracts/session-entry.js";

export const CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE = "vetta.legacy_agent_message";

const TextContentSchema = Type.Object(
	{ type: Type.Literal("text"), text: Type.String(), textSignature: Type.Optional(Type.String()) },
	{ additionalProperties: false },
);
const ImageContentSchema = Type.Object(
	{ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() },
	{ additionalProperties: false },
);
const CustomContentSchema = Type.Union([
	Type.String(),
	Type.Array(Type.Union([TextContentSchema, ImageContentSchema])),
]);
export const CodingAgentExtendedMessageSchema = Type.Union([
	Type.Object(
		{
			role: Type.Literal("bashExecution"),
			command: Type.String(),
			output: Type.String(),
			exitCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
			cancelled: Type.Boolean(),
			truncated: Type.Boolean(),
			fullOutputPath: Type.Optional(Type.String()),
			timestamp: Type.Number(),
			excludeFromContext: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			role: Type.Literal("custom"),
			customType: Type.String({ minLength: 1 }),
			content: CustomContentSchema,
			display: Type.Boolean(),
			details: Type.Optional(Type.Unknown()),
			timestamp: Type.Number(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			role: Type.Literal("branchSummary"),
			summary: Type.String(),
			fromId: Type.String({ minLength: 1 }),
			timestamp: Type.Number(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			role: Type.Literal("compactionSummary"),
			summary: Type.String(),
			tokensBefore: Type.Number({ minimum: 0 }),
			timestamp: Type.Number(),
		},
		{ additionalProperties: false },
	),
]);
const ExtendedMessageDetailsSchema = Type.Object(
	{ agentMessage: CodingAgentExtendedMessageSchema },
	{ additionalProperties: false },
);

/** Projects the extension-facing Session entry union into the native Conversation document union. */
export function projectCodingAgentSessionDocumentEntry(entry: CodingAgentSessionEntry): ConversationDocumentEntry {
	switch (entry.type) {
		case "message":
			return projectMessageEntry(entry);
		case "compaction": {
			const timestamp = new Date(entry.timestamp).getTime();
			if (!Number.isFinite(timestamp)) throw new Error(`Invalid Session entry timestamp: ${entry.timestamp}`);
			return {
				...entry,
				summaryMessage: createCodingAgentCompactionSummaryMessage(entry.summary, timestamp),
			};
		}
		case "custom_message":
			return {
				...entry,
				modelVisible: !isCodingAgentModelInvisibleCustomType(entry.customType),
			};
		case "tool_timing":
			return { ...entry, phases: [...entry.phases] };
		case "thinking_level_change":
		case "model_change":
		case "branch_summary":
		case "custom":
		case "label":
		case "session_info":
			return entry;
	}
}

function projectMessageEntry(entry: CodingAgentSessionMessageEntry): ConversationDocumentEntry {
	if (isNativeMessage(entry.message)) return entry;
	return {
		id: entry.id,
		parentId: entry.parentId,
		timestamp: entry.timestamp,
		...projectCodingAgentExtendedMessage(entry.message),
	};
}

export function projectCodingAgentExtendedMessage(message: AgentMessage) {
	const projected = convertToLlm([message])[0];
	return {
		type: "custom_message" as const,
		customType: CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE,
		content: projected?.content ?? "",
		details: { agentMessage: message },
		display: message.role === "custom" ? message.display : true,
		modelVisible: projected !== undefined,
	};
}

export function createCodingAgentCompactionSummaryMessage(summary: string, timestamp: number) {
	return {
		role: "user" as const,
		content: [{ type: "text" as const, text: COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX }],
		timestamp,
	};
}

export function isCodingAgentModelInvisibleCustomType(customType: string): boolean {
	return customType === PROMPT_RESOURCE_REFERENCE_TYPE || customType === PROMPT_ATTACHMENT_REFERENCE_TYPE;
}

/** Restores an extension-facing AgentMessage from the lossless Conversation context projection. */
export function restoreCodingAgentSessionAgentMessageEntry(
	entry: ConversationDocumentCustomMessageEntry,
): CodingAgentSessionMessageEntry | undefined {
	if (
		entry.customType !== CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE ||
		!Value.Check(ExtendedMessageDetailsSchema, entry.details)
	) {
		return undefined;
	}
	const message = entry.details.agentMessage as AgentMessage;
	const projected = convertToLlm([message])[0];
	if (
		entry.modelVisible !== (projected !== undefined) ||
		!isDeepStrictEqual(entry.content, projected?.content ?? "")
	) {
		return undefined;
	}
	return { type: "message", id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, message };
}

function isNativeMessage(message: AgentMessage): boolean {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}
