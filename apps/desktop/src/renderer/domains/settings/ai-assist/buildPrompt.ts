import { i18n } from "@shared/i18n";
import type { SettingsAiAssistCatalogEntry } from "./catalog";

export interface SettingsAiAssistPromptParts {
	/** Shown in the chat bubble and session title; sent as the user message text. */
	displayText: string;
	/**
	 * Model-only instruction injected via PromptRequest.metadata (display:false custom
	 * message in coding-agent input-pipeline). Never shown in the user bubble.
	 */
	agentInstruction: string;
}

/** Split user-visible intent from agent-only settings-assist context. */
export function buildSettingsAiAssistPromptParts(
	entry: SettingsAiAssistCatalogEntry,
	userIntent: string,
): SettingsAiAssistPromptParts {
	const page = i18n.t(`settings:${entry.contextLabelKey}`);
	const displayText = userIntent.trim() || i18n.t(`settings:${entry.defaultIntentKey}`);
	const agentInstruction = i18n.t("settings:aiAssist.prompt.agentInstruction", { page });
	return { displayText, agentInstruction };
}
