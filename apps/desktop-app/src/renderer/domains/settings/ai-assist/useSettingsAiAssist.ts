import { i18n } from "@shared/i18n";
import { activeSessionAtom, defaultConversationCwdAtom, openSessionFnRef, sendMessageFnRef } from "@shared/store/atoms";
import { getDefaultStore, useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { enqueueSettingsAssistJob } from "./assistJobQueue";
import { buildSettingsAiAssistPromptParts } from "./buildPrompt";
import { getSettingsAiAssistEntry, type SettingsAiAssistCatalogEntry, type SettingsAiAssistTabId } from "./catalog";
import { flyToSidebarSession, readAiAssistOriginRect } from "./flyToSidebarSession";

export interface SettingsAiAssistModel {
	entry: SettingsAiAssistCatalogEntry;
	dialogOpen: boolean;
	intent: string;
	submitError: string | null;
	openDialog: () => void;
	closeDialog: () => void;
	setIntent: (value: string) => void;
	applyExample: (text: string) => void;
	/** Optional origin rect from the submit click — preferred so the orb starts on the popover button. */
	submit: (originRect?: DOMRect | null) => Promise<void>;
}

export function useSettingsAiAssist(tabId: SettingsAiAssistTabId): SettingsAiAssistModel | null {
	const entry = getSettingsAiAssistEntry(tabId);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);

	const [dialogOpen, setDialogOpen] = useState(false);
	const [intent, setIntent] = useState("");
	const [submitError, setSubmitError] = useState<string | null>(null);

	const openDialog = useCallback(() => {
		setSubmitError(null);
		setDialogOpen(true);
	}, []);

	const closeDialog = useCallback(() => {
		setDialogOpen(false);
		setSubmitError(null);
	}, []);

	const applyExample = useCallback((text: string) => {
		setIntent(text);
		setSubmitError(null);
	}, []);

	const submit = useCallback(
		async (originFromClick?: DOMRect | null) => {
			if (!entry) return;
			const openSession = openSessionFnRef.current;
			const sendMessage = sendMessageFnRef.current;
			const cwd = defaultConversationCwd?.trim() ?? "";
			if (!cwd || !openSession || !sendMessage) {
				setSubmitError(i18n.t("settings:aiAssist.error.noWorkspace"));
				return;
			}

			// Snapshot before clearing UI — each submit is an independent assist session.
			const { displayText, agentInstruction } = buildSettingsAiAssistPromptParts(entry, intent);
			const clickOk =
				originFromClick != null && originFromClick.width > 0 && originFromClick.height > 0 ? originFromClick : null;
			const originRect = clickOk ?? readAiAssistOriginRect();
			const tabIdForJob = entry.tabId;

			setSubmitError(null);
			setDialogOpen(false);
			setIntent("");

			// Path filled in when this job's openSession resolves (not the global "busy" session).
			let jobSessionPath: string | undefined;
			void flyToSidebarSession(originRect, {
				getSessionPath: () => jobSessionPath,
			});

			// UI is free immediately; jobs serialize so openSession/sendMessage do not race.
			enqueueSettingsAssistJob(async () => {
				const open = openSessionFnRef.current;
				const send = sendMessageFnRef.current;
				if (!open || !send) {
					throw new Error(i18n.t("settings:aiAssist.error.noWorkspace"));
				}
				await open(cwd, undefined, undefined, { navigate: false });
				const path = getDefaultStore().get(activeSessionAtom)?.sessionPath?.trim();
				jobSessionPath = path || undefined;
				await send(displayText, {
					metadata: {
						settingsAssistInstruction: agentInstruction,
						settingsAssistTabId: tabIdForJob,
					},
					settingsAssistTabId: tabIdForJob,
				});
			});
		},
		[defaultConversationCwd, entry, intent],
	);

	return useMemo(() => {
		if (!entry) return null;
		return {
			entry,
			dialogOpen,
			intent,
			submitError,
			openDialog,
			closeDialog,
			setIntent,
			applyExample,
			submit,
		};
	}, [entry, dialogOpen, intent, submitError, openDialog, closeDialog, applyExample, submit]);
}
