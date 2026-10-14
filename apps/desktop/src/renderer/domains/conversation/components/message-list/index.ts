/** Desktop composition API. Plugin SDK consumers must not deep-import application modules. */

export { SessionConversation } from "../../session-conversation/SessionConversation";
export { SessionUserMessage } from "../../session-conversation/SessionUserMessage";
export { ChatComposer, ChatError, DefaultChatView } from "../chat-view/DefaultChatView";
export { TranscriptConversation } from "../TranscriptConversation";
export type { MessageItemProps } from "./MessageItem";
export { ExportMessageList, MessageItem } from "./MessageItem";
export { ReadonlyUserMessage, UserMessageCopyAction } from "./ReadonlyUserMessage";
export type { UserMessageProps } from "./UserMessage";
export { UserMessage } from "./UserMessage";
