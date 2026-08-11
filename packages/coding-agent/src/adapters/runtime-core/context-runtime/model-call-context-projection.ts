import type { AgentMessage } from "@vetta/agent-core";
import type { Message } from "@vetta/ai";
import type { RuntimeMessageEnvelope } from "@vetta/runtime-core";
import type { ModelCallContextTransformationInput } from "@vetta/runtime-core/kernel";
import { estimateContextTokens, microcompact, reduceContextByPressure } from "../../../compaction/index.js";
import { convertToLlm, createCustomMessage } from "../../../model-context/index.js";
import type { CodingAgentContextRuntimeOptions } from "./contracts.js";

export interface ProjectedModelCallContext {
	readonly messages: readonly Message[];
	readonly estimatedTokens: number;
}

export async function projectModelCallContext(
	input: ModelCallContextTransformationInput,
	transformAgentContext: CodingAgentContextRuntimeOptions["transformAgentContext"],
	signal: AbortSignal,
): Promise<ProjectedModelCallContext> {
	signal.throwIfAborted();
	const envelopes = input.messageEnvelopes ?? input.messages.map(toMessageEnvelope);
	const continuationMessages = new WeakSet<object>();
	for (const envelope of envelopes) {
		if (envelope.kind === "message" && envelope.origin?.kind === "continuation") {
			continuationMessages.add(envelope.message);
		}
	}
	const agentMessages = envelopes.flatMap(toAgentMessages);
	const invisibleIdentities = readInvisibleIdentityCounts(envelopes);
	const extensionMessages = transformAgentContext ? await transformAgentContext(agentMessages, signal) : agentMessages;
	signal.throwIfAborted();
	const visibleMessages = microcompact([...extensionMessages], {
		keepRecent: 8,
		maxAgeMs: 30 * 1000,
		pruneToolResults: false,
	}).filter((message) => !consumeIdentity(invisibleIdentities, message));
	const messages = convertToLlm(
		reduceContextByPressure(visibleMessages, {
			contextWindow: input.modelBinding.model.contextWindow,
			estimatedTokens: estimateContextTokens(visibleMessages).tokens,
			isRealUserTurn: (message) => message.role === "user" && !continuationMessages.has(message),
		}),
	);
	return { messages, estimatedTokens: estimateContextTokens(messages).tokens };
}

function toAgentMessages(envelope: RuntimeMessageEnvelope): AgentMessage[] {
	if (envelope.kind === "message") return [envelope.message];
	if (envelope.kind === "context") {
		return [
			createCustomMessage(
				envelope.record.type,
				envelope.record.content,
				envelope.record.display ?? false,
				envelope.record.metadata,
				new Date(envelope.timestamp).toISOString(),
			),
		];
	}
	return isAgentMessage(envelope.identity)
		? [envelope.identity]
		: envelope.modelMessage
			? [envelope.modelMessage]
			: [];
}

function toMessageEnvelope(message: Message): RuntimeMessageEnvelope {
	return { kind: "message", message };
}

function readInvisibleIdentityCounts(envelopes: readonly RuntimeMessageEnvelope[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const envelope of envelopes) {
		const invisible =
			(envelope.kind === "context" && !envelope.record.modelVisible) ||
			(envelope.kind === "opaque" && !envelope.modelMessage);
		if (!invisible) continue;
		for (const message of toAgentMessages(envelope)) {
			const key = messageIdentityKey(message);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}

function consumeIdentity(counts: Map<string, number>, message: AgentMessage): boolean {
	const key = messageIdentityKey(message);
	const count = counts.get(key) ?? 0;
	if (count === 0) return false;
	if (count === 1) counts.delete(key);
	else counts.set(key, count - 1);
	return true;
}

function messageIdentityKey(message: AgentMessage): string {
	const discriminator = message.role === "custom" ? message.customType : message.role;
	return `${discriminator}:${message.timestamp}`;
}

function isAgentMessage(value: unknown): value is AgentMessage {
	return (
		value !== null &&
		typeof value === "object" &&
		"role" in value &&
		typeof value.role === "string" &&
		AGENT_MESSAGE_ROLES.has(value.role)
	);
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
