import { useMemo } from "react";
import { SUBAGENT_CARDS_EXTENSION } from "../components/message-list/SubagentCardsScope";
import { useConversationExtension } from "./extensions";
import { useConversationCapability } from "./feed";

/**
 * Shows subagent progress cards under the tool calls that started them. The
 * cards belong to the Runtime the feed names in `subagentRuntimeId`; a feed
 * without one shows none even with this extension mounted.
 */
export function SubagentCardsExtension() {
	const runtimeId = useConversationCapability("subagentRuntimeId");
	useConversationExtension(useMemo(() => ({ id: SUBAGENT_CARDS_EXTENSION, value: runtimeId }), [runtimeId]));
	return null;
}
