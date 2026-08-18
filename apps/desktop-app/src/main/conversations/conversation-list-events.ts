export interface ConversationListChangedEvent {
	cwd: string;
	sessionPath: string;
	session?: {
		id: string;
		cwd: string;
		firstMessage: string;
		modifiedAt: number;
	};
}

type ConversationListChangedHandler = (event: ConversationListChangedEvent) => void;

const handlers = new Set<ConversationListChangedHandler>();

export function emitConversationListChanged(event: ConversationListChangedEvent): void {
	for (const handler of handlers) {
		try {
			handler(event);
		} catch {
			// 会话已经落盘，观察者异常不能反向破坏创建或 prompt 结果。
		}
	}
}

export function onConversationListChanged(handler: ConversationListChangedHandler): () => void {
	handlers.add(handler);
	return () => {
		handlers.delete(handler);
	};
}
