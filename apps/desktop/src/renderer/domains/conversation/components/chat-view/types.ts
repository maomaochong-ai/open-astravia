import type { ChatConversationItem } from "@shared/store/atoms";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";

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
}

export interface ChatViewModel {
	cwd: string | null;
	exporting: boolean;
	exportTitle: string;
	header: ChatViewHeaderModel;
	isStreaming: boolean;
	pendingLabel?: string;
	messages: ChatConversationItem[];
	rootClassName?: string;
	sessionId: string | null;
	workSurface: WorkSurfaceScope | null;
}

export interface ChatViewActions {
	finishExport: () => void;
	openExport: () => void;
	togglePanel: () => void;
}

export interface ChatViewModelResult {
	actions: ChatViewActions;
	model: ChatViewModel;
}
