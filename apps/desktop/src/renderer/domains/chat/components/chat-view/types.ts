import type { ChatMessage } from "@shared/store/atoms";

export interface ChatViewProps {
	onAbort: () => Promise<void>;
	onSend: (overrideText?: string) => Promise<void>;
	onSendQueued: (runtimeId: string, id: string) => Promise<void>;
}

export interface ChatViewHeaderModel {
	exportDisabled: boolean;
	exporting: boolean;
	exportTitle: string;
	panelOpen: boolean;
	panelTitle: string;
	pinTitle: string;
	pinned: boolean;
}

export interface ChatViewModel {
	exporting: boolean;
	exportTitle: string;
	header: ChatViewHeaderModel;
	isStreaming: boolean;
	messages: ChatMessage[];
	rootClassName?: string;
	sessionId: string | null;
}

export interface ChatViewActions {
	finishExport: () => void;
	openExport: () => void;
	togglePanel: () => void;
	togglePin: () => Promise<void>;
}

export interface ChatViewModelResult {
	actions: ChatViewActions;
	model: ChatViewModel;
}
