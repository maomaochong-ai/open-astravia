/**
 * Composable conversation view (ADR-0147): a headless feed, compound parts that
 * place things, message templates for per-message structure, and registered
 * extensions for cross-cutting features.
 */

import {
	ConversationFooter,
	ConversationMessages,
	ConversationScrollToBottom,
	ConversationTimelineRail,
} from "./parts";
import { ConversationRoot } from "./root";
import { AgentMessageTemplate, EventMessageTemplate, UserMessageTemplate } from "./templates";
import { ConversationViewport } from "./viewport";

export const Conversation = {
	Root: ConversationRoot,
	Viewport: ConversationViewport,
	Messages: ConversationMessages,
	UserMessage: UserMessageTemplate,
	AgentMessage: AgentMessageTemplate,
	EventMessage: EventMessageTemplate,
	Footer: ConversationFooter,
	TimelineRail: ConversationTimelineRail,
	ScrollToBottom: ConversationScrollToBottom,
} as const;

export type { AgentMessageInput } from "./agent-message";
export { AgentMessage, AgentMessageProvider, useAgentMessage } from "./agent-message";
export { EventMessage } from "./event-message";
export type { ConversationExtension, ConversationRowDecoratorProps } from "./extensions";
export { useConversationExtension, useConversationExtensionValue } from "./extensions";
export type { ConversationCapabilities, ConversationFeed, ConversationFeedInput, UserMessageCommands } from "./feed";
export { createConversationFeed, useConversationCapability, useConversationFeed } from "./feed";
export type { ConversationMessageRow } from "./message-scope";
export { useMessage, useMessageRow } from "./message-scope";
export { SubagentCardsExtension } from "./subagent-cards";
export { UserMessage, useUserMessage } from "./user-message";
export type { ConversationViewportModel } from "./viewport-frame";
export { ConversationViewportFrame, useConversationViewport } from "./viewport-frame";
