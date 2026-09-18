function importChatPage() {
	return import("./ChatPage").then((module) => ({ default: module.ChatPage }));
}

let chatPagePromise: ReturnType<typeof importChatPage> | null = null;

export function loadChatPage(): ReturnType<typeof importChatPage> {
	chatPagePromise ??= importChatPage();
	return chatPagePromise;
}
