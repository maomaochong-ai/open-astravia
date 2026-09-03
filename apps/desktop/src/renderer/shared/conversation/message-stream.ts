import type { AssistantMessage, AssistantMessageEvent } from "@vetta/ai";
import type { ConversationAgentMessageEvent } from "@vetta/runtime-core/conversation";
import type { ContentBlock, ToolCallBlock } from "./content-blocks";
import { createConversationAgentMessage } from "./message-factories";
import type { ConversationAgentMessageViewModel } from "./types";

export interface ConversationMessageEventState {
	readonly conversationId: string;
	readonly sequence: number;
	readonly message: ConversationAgentMessageViewModel;
}

/** Applies an identity-scoped protocol event without assuming a Chat or Team owner. */
export function reduceConversationMessageEvent(
	state: ConversationMessageEventState | undefined,
	envelope: ConversationAgentMessageEvent,
): ConversationMessageEventState {
	if (state && (state.conversationId !== envelope.conversationId || state.message.id !== envelope.messageId)) {
		throw new Error("Conversation message event does not match its reduction state");
	}
	if (state && envelope.sequence <= state.sequence) return state;

	const message =
		state?.message ??
		createConversationAgentMessage({
			id: envelope.messageId,
			entryId: envelope.messageId,
			turnId: envelope.turnId,
			authorId: envelope.author.id,
			phase: "streaming",
			text: "",
			blocks: [],
			timestamp: envelope.timestamp,
			startedAt: envelope.timestamp,
		});
	const next = projectAssistantEvent(message, envelope.event, envelope.messageId);
	return { conversationId: envelope.conversationId, sequence: envelope.sequence, message: next };
}

function projectAssistantEvent(
	message: ConversationAgentMessageViewModel,
	event: AssistantMessageEvent,
	messageId: string,
): ConversationAgentMessageViewModel {
	if (event.type === "text_delta") return appendText(message, event.delta, messageId);
	if (event.type === "thinking_delta") return appendThinking(message, event.delta, messageId);
	if (event.type === "toolcall_start" || event.type === "toolcall_delta" || event.type === "toolcall_end") {
		return mergeToolCall(message, event, messageId);
	}
	if (event.type === "text_end" && !message.blocks.some((block) => block.type === "text")) {
		return appendText(message, event.content, messageId);
	}
	if (event.type === "thinking_end" && !message.blocks.some((block) => block.type === "thinking")) {
		return appendThinking(message, event.content, messageId);
	}
	if (event.type === "done" || event.type === "error") {
		return mergeTerminalMessage(
			message,
			event.type === "done" ? event.message : event.error,
			messageId,
			event.type === "done" ? "completed" : event.reason === "aborted" ? "aborted" : "failed",
		);
	}
	return message;
}

function appendText(
	message: ConversationAgentMessageViewModel,
	delta: string,
	messageId: string,
): ConversationAgentMessageViewModel {
	if (delta.length === 0) return message;
	const blocks = [...message.blocks];
	const last = blocks.at(-1);
	if (last?.type === "text") blocks[blocks.length - 1] = { ...last, text: `${last.text}${delta}` };
	else blocks.push({ type: "text", id: `${messageId}:text:${blocks.length}`, text: delta });
	return { ...message, phase: "streaming", text: `${message.text ?? ""}${delta}`, blocks };
}

function appendThinking(
	message: ConversationAgentMessageViewModel,
	delta: string,
	messageId: string,
): ConversationAgentMessageViewModel {
	if (delta.length === 0) return message;
	const blocks = [...message.blocks];
	const last = blocks.at(-1);
	if (last?.type === "thinking") blocks[blocks.length - 1] = { ...last, text: `${last.text}${delta}` };
	else blocks.push({ type: "thinking", id: `${messageId}:thinking:${blocks.length}`, text: delta });
	return { ...message, phase: "streaming", blocks };
}

function mergeToolCall(
	message: ConversationAgentMessageViewModel,
	event: Extract<AssistantMessageEvent, { type: "toolcall_start" | "toolcall_delta" | "toolcall_end" }>,
	messageId: string,
): ConversationAgentMessageViewModel {
	const part = event.type === "toolcall_end" ? event.toolCall : event.partial.content[event.contentIndex];
	if (part?.type !== "toolCall") return message;
	const args = isRecord(part.arguments) ? part.arguments : {};
	const blocks = [...message.blocks];
	const index = blocks.findIndex((block) => block.type === "tool_call" && block.toolCallId === part.id);
	if (index >= 0) {
		const current = blocks[index] as ToolCallBlock;
		blocks[index] = {
			...current,
			toolName: part.name || current.toolName,
			args: Object.keys(args).length > 0 ? args : current.args,
		};
	} else {
		blocks.push({
			type: "tool_call",
			toolCallId: part.id || `${messageId}:tool:${blocks.length}`,
			toolName: part.name,
			args,
			status: "pending",
		});
	}
	return { ...message, phase: "streaming", blocks };
}

function mergeTerminalMessage(
	message: ConversationAgentMessageViewModel,
	terminal: AssistantMessage,
	messageId: string,
	phase: "completed" | "failed" | "aborted",
): ConversationAgentMessageViewModel {
	let next = message;
	if (next.blocks.length === 0) {
		const blocks = projectAssistantMessageBlocks(terminal, messageId);
		next = {
			...next,
			text: blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
			blocks,
		};
	} else {
		for (let index = 0; index < terminal.content.length; index += 1) {
			const part = terminal.content[index];
			if (part?.type !== "toolCall") continue;
			next = mergeToolCall(
				next,
				{ type: "toolcall_end", contentIndex: index, toolCall: part, partial: terminal },
				messageId,
			);
		}
	}
	const endedAt = terminal.timestamp;
	return {
		...next,
		phase,
		usages: [...(next.usages ?? []), terminal.usage],
		endedAt,
		...(next.startedAt === undefined ? {} : { durationSeconds: Math.max(0, (endedAt - next.startedAt) / 1_000) }),
	};
}

/** Projects provider-neutral Assistant content into the shared Renderer block contract. */
export function projectAssistantMessageBlocks(
	message: AssistantMessage,
	messageId: string,
	toolStatus: ToolCallBlock["status"] = "pending",
): ContentBlock[] {
	return message.content.flatMap((part, index): ContentBlock[] => {
		if (part.type === "text") return [{ type: "text", id: `${messageId}:text:${index}`, text: part.text }];
		if (part.type === "thinking") {
			return [{ type: "thinking", id: `${messageId}:thinking:${index}`, text: part.thinking }];
		}
		if (part.type === "toolCall") {
			return [
				{
					type: "tool_call",
					toolCallId: part.id,
					toolName: part.name,
					args: isRecord(part.arguments) ? part.arguments : {},
					status: toolStatus,
				},
			];
		}
		return [];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
