import type { ConversationTagsSnapshot } from "../../shared/conversation-tags.js";

export interface DesktopConversationTagsApi {
	list: () => Promise<ConversationTagsSnapshot>;
	create: (input: { name: string; color: string; sessionPath?: string }) => Promise<ConversationTagsSnapshot>;
	update: (input: { id: string; name?: string; color?: string }) => Promise<ConversationTagsSnapshot>;
	remove: (tagId: string) => Promise<ConversationTagsSnapshot>;
	assign: (input: { sessionPath: string; tagId: string; assigned: boolean }) => Promise<ConversationTagsSnapshot>;
	forgetConversations: (sessionPaths: readonly string[]) => Promise<ConversationTagsSnapshot>;
	onChanged: (listener: (snapshot: ConversationTagsSnapshot) => void) => () => void;
}
