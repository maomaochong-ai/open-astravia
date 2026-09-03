import { activeSessionAtom, pendingSessionCreationAtom, pendingSessionOpenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import type { ChatPageModel } from "../components/chat-page/types";

export function useChatPageModel(): ChatPageModel {
	const activeSession = useAtomValue(activeSessionAtom);
	const pendingSessionCreation = useAtomValue(pendingSessionCreationAtom);
	const pendingSessionOpen = useAtomValue(pendingSessionOpenAtom);
	return {
		hasActiveSession: activeSession !== null || pendingSessionCreation !== null || pendingSessionOpen !== null,
		pendingCwd: pendingSessionCreation?.cwd ?? pendingSessionOpen?.cwd,
	};
}
