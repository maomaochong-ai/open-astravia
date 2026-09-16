import type { ConversationMessage, ConversationState, PluginConversationApi } from "./conversation.js";
import type { PluginPromptAttachment } from "./prompt-attachment.js";
import type { PluginSidebarState } from "./ui.js";

// ─── Host bridge ───
//
// React hooks and conversation state read the host's jotai store. plugin-sdk
// cannot depend on desktop-app, so the host injects its implementation at
// startup (installPluginHostShim → __setPluginHostBridge). Module Federation
// makes host and plugins share this single pluginSdk instance, so the bridge
// the host sets is visible to the hooks the plugin calls.

export interface PluginHostBridge {
	useActiveConversation(): ConversationState;
	useConversationMessages(): ConversationMessage[];
	usePromptAttachment(): PluginPromptAttachment | null;
	/** Reactive: the host's current locale code (e.g. "zh"). */
	useLocale(): string;
	/** Reactive: the host sidebar's current shape (collapsed / narrow / visible). */
	useSidebarState(): PluginSidebarState;
	conversation: PluginConversationApi;
}

let hostBridge: PluginHostBridge | undefined;

export function __setPluginHostBridge(bridge: PluginHostBridge): void {
	hostBridge = bridge;
}

/** Package-internal: throws if the host has not installed the bridge yet. */
export function requireBridge(): PluginHostBridge {
	if (!hostBridge) {
		throw new Error("Vetta plugin host bridge is not installed");
	}
	return hostBridge;
}
