import { isConversationBusyAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { type UserMessageCommands, useConversationCapability } from "../conversation-view";
import {
	useUserMessageDeleteAction,
	useUserMessageEditAction,
	useUserMessageHistoryActions,
} from "../hooks/useUserMessageActions";

/**
 * User message commands of the active session: they act on its Runtime, the
 * composer draft and the session history.
 */
export const sessionUserMessageCommands: UserMessageCommands = {
	useEdit(message, isLastUserMessage) {
		return useUserMessageEditAction({ message, isLastUserMessage, enabled: true });
	},
	useHistory(message) {
		const isStreaming = useAtomValue(isConversationBusyAtom);
		const abort = useConversationCapability("abort");
		return useUserMessageHistoryActions({ message, isStreaming, onAbortEdit: abort, forkEnabled: true });
	},
	useDelete(message) {
		const isStreaming = useAtomValue(isConversationBusyAtom);
		const abort = useConversationCapability("abort");
		return useUserMessageDeleteAction({ message, isStreaming, onAbortEdit: abort, enabled: true });
	},
};
