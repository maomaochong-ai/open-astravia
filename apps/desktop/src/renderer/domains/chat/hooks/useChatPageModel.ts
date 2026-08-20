import { activeSessionAtom, pendingSessionCreationAtom, pendingSessionOpenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import type { ChatPageModel } from "../components/chat-page/types";

export function useChatPageModel(): ChatPageModel {
	const activeSession = useAtomValue(activeSessionAtom);
	const pendingSessionCreation = useAtomValue(pendingSessionCreationAtom);
	const pendingSessionOpen = useAtomValue(pendingSessionOpenAtom);
	const { t } = useTranslation("chat");

	return {
		hasActiveSession: activeSession !== null || pendingSessionCreation !== null || pendingSessionOpen !== null,
		pendingCwd: pendingSessionCreation?.cwd ?? pendingSessionOpen?.cwd,
		sessionPending: pendingSessionCreation !== null || pendingSessionOpen !== null,
		// Existing-session history is its own visible feedback. Keep only the
		// brand-new session label, where there is no history to paint yet.
		sessionPendingLabel: pendingSessionCreation ? t("chatView.startingSession") : undefined,
	};
}
