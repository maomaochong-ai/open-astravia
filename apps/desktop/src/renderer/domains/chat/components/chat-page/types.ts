export interface ChatPageModel {
	hasActiveSession: boolean;
	pendingCwd?: string;
	sessionPending: boolean;
	sessionPendingLabel?: string;
}

export interface ChatPageViewProps {
	model: ChatPageModel;
	onAbort: () => Promise<void>;
	onSend: (overrideText?: string) => Promise<void>;
	onSendQueued: (runtimeId: string, id: string) => Promise<void>;
}
