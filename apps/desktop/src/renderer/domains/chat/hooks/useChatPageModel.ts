import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import type { ChatPageModel } from "../components/chat-page/types";

export function useChatPageModel(): ChatPageModel {
	const activeSession = useAtomValue(activeSessionAtom);

	return {
		hasActiveSession: activeSession !== null,
	};
}
