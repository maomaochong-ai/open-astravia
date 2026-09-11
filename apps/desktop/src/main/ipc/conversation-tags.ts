import { ipcMain, type WebContents } from "electron";
import { CONVERSATION_TAGS_CHANGED_CHANNEL, type ConversationTagsSnapshot } from "../../shared/conversation-tags.js";
import {
	addConversationTag,
	assignConversationTag,
	forgetConversations,
	listConversationTags,
	onConversationTagsChanged,
	removeConversationTag,
	renameConversationTag,
} from "../conversations/conversation-tags-store.js";

const CHANNELS = {
	LIST: "vetta:conversation-tags:list",
	CREATE: "vetta:conversation-tags:create",
	UPDATE: "vetta:conversation-tags:update",
	DELETE: "vetta:conversation-tags:delete",
	ASSIGN: "vetta:conversation-tags:assign",
	FORGET: "vetta:conversation-tags:forget",
} as const;

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function registerConversationTagsIpc(webContents: WebContents): () => void {
	ipcMain.handle(CHANNELS.LIST, () => listConversationTags());

	ipcMain.handle(CHANNELS.CREATE, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return addConversationTag({
			name: asString(raw.name),
			color: asString(raw.color),
			sessionPath: asOptionalString(raw.sessionPath),
		});
	});

	ipcMain.handle(CHANNELS.UPDATE, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return renameConversationTag({
			id: asString(raw.id),
			name: asOptionalString(raw.name),
			color: asOptionalString(raw.color),
		});
	});

	ipcMain.handle(CHANNELS.DELETE, (_event, tagId: unknown) => removeConversationTag(asString(tagId)));

	ipcMain.handle(CHANNELS.ASSIGN, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return assignConversationTag({
			sessionPath: asString(raw.sessionPath),
			tagId: asString(raw.tagId),
			assigned: raw.assigned === true,
		});
	});

	ipcMain.handle(CHANNELS.FORGET, (_event, sessionPaths: unknown) =>
		forgetConversations(
			Array.isArray(sessionPaths) ? sessionPaths.filter((p): p is string => typeof p === "string") : [],
		),
	);

	const unsubscribe = onConversationTagsChanged((snapshot: ConversationTagsSnapshot) => {
		if (webContents.isDestroyed()) return;
		webContents.send(CONVERSATION_TAGS_CHANGED_CHANNEL, snapshot);
	});

	return () => {
		unsubscribe();
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
