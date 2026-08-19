import { activeSessionAtom, pendingSessionCreationAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import type { ChatPageModel } from "../components/chat-page/types";

export function useChatPageModel(): ChatPageModel {
	const activeSession = useAtomValue(activeSessionAtom);
	const pendingSessionCreation = useAtomValue(pendingSessionCreationAtom);
	const { t } = useTranslation("chat");

	return {
		hasActiveSession: activeSession !== null || pendingSessionCreation !== null,
		pendingCwd: pendingSessionCreation?.cwd,
		sessionPendingLabel: pendingSessionCreation ? t("chatView.startingSession") : undefined,
	};
}
