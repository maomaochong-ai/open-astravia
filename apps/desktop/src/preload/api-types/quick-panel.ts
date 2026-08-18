import type { QuickPanelRunPromptPayload } from "../../shared/quickpanel-ipc.js";

export interface DesktopQuickPanelApi {
	reloadHotkey(): Promise<void>;
	onRunPrompt(handler: (payload: QuickPanelRunPromptPayload) => void): () => void;
}
