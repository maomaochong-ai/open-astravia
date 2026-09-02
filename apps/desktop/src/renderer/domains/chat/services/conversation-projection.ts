import type { ChatMessage } from "@shared/store/atoms";
import type { AssistantMessageEvent } from "@vetta/ai";
import type { AssistantSessionEvent, HistoryEntry } from "@vetta/runtime-core";
import {
	appendTextDelta,
	appendThinkingDelta,
	finalizeMessage,
	fullHistoryToChat,
	handleToolStart,
	resetStreamState,
} from "./chat-service";

function partialToolCall(
	event: AssistantMessageEvent,
): { readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> } | undefined {
	if (event.type !== "toolcall_start" && event.type !== "toolcall_delta" && event.type !== "toolcall_end") {
		return undefined;
	}
	const part = event.partial.content[event.contentIndex];
	if (part?.type !== "toolCall") return undefined;
	return {
		id: part.id,
		name: part.name,
		arguments:
			part.arguments && typeof part.arguments === "object" && !Array.isArray(part.arguments)
				? (part.arguments as Record<string, unknown>)
				: {},
	};
}

/**
 * Desktop 对 Conversation 的唯一消息投影入口。
 *
 * 历史由 durable HistoryEntry 投影；实时更新直接消费无损的
 * AssistantMessageEvent。事件批处理只降低 React 提交频率，不按类型合并，
 * 因而 thinking/text/tool 的交错顺序不会被改变。
 */
export class ConversationProjection {
	private pendingAssistantEvents: AssistantSessionEvent[] = [];
	private lastSequence: number | undefined;
	private rawAssistantStream = false;

	projectHistory(history: HistoryEntry[]): ChatMessage[] {
		return fullHistoryToChat(history);
	}

	enqueue(event: AssistantSessionEvent): void {
		if (event.sequence !== undefined && this.lastSequence !== undefined && event.sequence <= this.lastSequence)
			return;
		if (event.sequence !== undefined) this.lastSequence = event.sequence;
		this.rawAssistantStream = true;
		this.pendingAssistantEvents.push(event);
	}

	hasRawAssistantStream(): boolean {
		return this.rawAssistantStream;
	}

	hasPendingEvents(): boolean {
		return this.pendingAssistantEvents.length > 0;
	}

	flush(messages: ChatMessage[]): ChatMessage[] {
		const pending = this.pendingAssistantEvents;
		this.pendingAssistantEvents = [];
		let projected = messages;
		for (const event of pending) {
			if (event.type === "text_delta") {
				projected = appendTextDelta(projected, event.delta);
				continue;
			}
			if (event.type === "thinking_delta") {
				projected = appendThinkingDelta(projected, event.delta);
				continue;
			}
			const toolCall = partialToolCall(event);
			if (toolCall) {
				projected = handleToolStart(projected, toolCall.id, toolCall.name, toolCall.arguments);
				continue;
			}
			if (event.type === "done") {
				projected = finalizeMessage(projected, event.message.content, event.message.usage);
				continue;
			}
			if (event.type === "error") {
				projected = finalizeMessage(projected, event.error.content, event.error.usage);
			}
		}
		return projected;
	}

	reset(): void {
		this.pendingAssistantEvents = [];
		this.lastSequence = undefined;
		this.rawAssistantStream = false;
		resetStreamState();
	}
}
