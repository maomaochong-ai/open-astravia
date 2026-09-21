import type { ChatConversationItem } from "@shared/store/atoms";

export interface ChatViewProps {
	onAbort: () => Promise<void>;
	onSend: (overrideText?: string) => Promise<void>;
	onSendQueued: (runtimeId: string, id: string) => Promise<void>;
	cwdOverride?: string;
}

export interface ChatViewHeaderModel {
	exportDisabled: boolean;
	exporting: boolean;
	exportTitle: string;
	panelOpen: boolean;
	panelTitle: string;
	bottomPanelOpen: boolean;
	bottomPanelTitle: string;
	pinTitle: string;
	pinned: boolean;
}

export interface ChatViewModel {
	cwd: string | null;
	exporting: boolean;
	exportTitle: string;
	header: ChatViewHeaderModel;
	isStreaming: boolean;
	messages: ChatConversationItem[];
	rootClassName?: string;
	sessionId: string | null;
}

export interface ChatViewActions {
	finishExport: () => void;
	openExport: () => void;
	togglePanel: () => void;
	toggleBottomPanel: () => void;
	togglePin: () => Promise<void>;
}

export interface ChatViewModelResult {
	actions: ChatViewActions;
	model: ChatViewModel;
}
