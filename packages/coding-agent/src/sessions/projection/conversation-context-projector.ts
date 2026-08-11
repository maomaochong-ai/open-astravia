import type { AgentMessage } from "@vetta/agent-core";
import type { Message } from "@vetta/ai";
import type { ConversationDocument, RuntimeMessageEnvelope } from "@vetta/runtime-core";
import type { ConversationContextProjector } from "@vetta/runtime-core/kernel";
import { convertToLlm } from "../../model-context/index.js";
import type {
	CodingAgentCustomMessageEntry as CustomMessageEntry,
	CodingAgentSessionEntry as SessionEntry,
} from "../contracts/session-entry.js";
import { projectCodingAgentSessionContextEntries } from "./session-context.js";
import { restoreCodingAgentSessionAgentMessageEntry } from "./session-document-entry.js";

/** 将持久化活动分支恢复为 Coding Agent 的完整 AgentMessage 身份。 */
export class CodingAgentConversationContextProjector implements ConversationContextProjector {
	project(document: ConversationDocument): readonly RuntimeMessageEnvelope[] {
		const entries = document.entries.map(toSessionEntry);
		const projection = projectCodingAgentSessionContextEntries(
			entries,
			document.activeLeafId,
			new Map(entries.map((entry) => [entry.id, entry])),
		);
		const documentEntries = new Map(document.entries.map((entry) => [entry.id, entry]));
		const envelopes: RuntimeMessageEnvelope[] = [];
		for (const { message, entry } of projection.items) {
			const source = documentEntries.get(entry.id);
			const modelMessage =
				source?.type === "compaction" && source.summaryMessage
					? source.summaryMessage
					: source?.type === "custom_message" && source.modelVisible === false
						? undefined
						: convertToLlm([message])[0];
			if (!modelMessage) {
				envelopes.push({ kind: "opaque", identity: message, timestamp: message.timestamp });
				continue;
			}
			if (isRuntimeMessage(message)) {
				envelopes.push({
					kind: "message",
					message,
					...(source?.type === "message" && source.origin ? { origin: source.origin } : {}),
				});
				continue;
			}
			envelopes.push({
				kind: "opaque",
				identity: message,
				modelMessage,
				timestamp: message.timestamp,
			});
		}
		return envelopes;
	}
}

/** Restore the active branch to the product-level AgentMessage identities used by hosts. */
export function projectCodingAgentMessages(document: ConversationDocument): readonly AgentMessage[] {
	return new CodingAgentConversationContextProjector().project(document).map((envelope) => {
		if (envelope.kind === "message") return envelope.message;
		if (envelope.kind === "opaque") return readAgentMessage(envelope.identity);
		throw new Error("Coding Agent conversation projector returned a context-only envelope");
	});
}

function toSessionEntry(entry: ConversationDocument["entries"][number]): SessionEntry {
	switch (entry.type) {
		case "message":
			return { ...entry, message: readAgentMessage(entry.message) };
		case "custom_message":
			return (
				restoreCodingAgentSessionAgentMessageEntry(entry) ?? {
					...entry,
					content: readCustomMessageContent(entry.content),
				}
			);
		case "tool_timing":
			return { ...entry, phases: [...entry.phases] };
		case "label":
			return { ...entry, label: entry.label };
		case "compaction": {
			const { reason: _reason, summaryMessage: _summaryMessage, ...legacyEntry } = entry;
			return legacyEntry;
		}
		default:
			return { ...entry };
	}
}

function readAgentMessage(value: unknown): AgentMessage {
	if (!value || typeof value !== "object" || !("role" in value) || typeof value.role !== "string") {
		throw new Error("Conversation message entry is not an AgentMessage");
	}
	if (!AGENT_MESSAGE_ROLES.has(value.role)) {
		throw new Error(`Unsupported conversation message role: ${value.role}`);
	}
	return value as AgentMessage;
}

function readCustomMessageContent(value: unknown): CustomMessageEntry["content"] {
	if (typeof value === "string") return value;
	if (!Array.isArray(value) || !value.every(isContentBlock)) {
		throw new Error("Conversation custom message has invalid content");
	}
	return value;
}

function isContentBlock(
	value: unknown,
): value is CustomMessageEntry["content"] extends readonly (infer T)[] ? T : never {
	if (!value || typeof value !== "object" || !("type" in value)) return false;
	if (value.type === "text") return "text" in value && typeof value.text === "string";
	return (
		value.type === "image" &&
		"data" in value &&
		typeof value.data === "string" &&
		"mimeType" in value &&
		typeof value.mimeType === "string"
	);
}

function isRuntimeMessage(message: AgentMessage): message is Message {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

const AGENT_MESSAGE_ROLES = new Set([
	"user",
	"assistant",
	"toolResult",
	"bashExecution",
	"custom",
	"branchSummary",
	"compactionSummary",
]);
