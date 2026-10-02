import { activeSessionAtom } from "@shared/store/atoms";
import { atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";
import { Conversation, createConversationFeed } from "../conversation-view";
import { ExportMessageList } from "./message-list/MessageItem";
import type { MessageListProps } from "./message-list/types";

export { ExportMessageList };

const activeRuntimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId ?? null);
const activeSessionPathAtom = selectAtom(activeSessionAtom, (session) => session?.sessionPath ?? null);

/**
 * Compatibility shell over the composable conversation view (ADR-0147): builds a
 * feed from props and composes the default parts. New code composes
 * `Conversation.*` directly; this shell goes away once every caller has moved.
 */
export function MessageList(props: MessageListProps): JSX.Element {
	const activeRuntimeId = useAtomValue(activeRuntimeIdAtom);
	const activeSessionPath = useAtomValue(activeSessionPathAtom);
	const subagentRuntimeId =
		props.sessionId && props.sessionId === activeSessionPath ? (activeRuntimeId ?? undefined) : undefined;
	const items = useMemo(() => atom(props.messages), [props.messages]);
	const streaming = useMemo(() => atom(props.isStreaming), [props.isStreaming]);
	const { initialTargetKey, onInitialTargetHandled, onAbort, onTeamMemberOpen } = props;
	const feed = useMemo(
		() =>
			createConversationFeed({
				key: props.sessionId ?? null,
				items,
				streaming,
				workspace: props.workspace,
				...(props.participants ? { participants: props.participants } : {}),
				...(props.pendingLabel ? { pendingLabel: props.pendingLabel } : {}),
				...(initialTargetKey
					? { scrollTarget: { key: initialTargetKey, onReached: onInitialTargetHandled ?? (() => undefined) } }
					: {}),
				capabilities: {
					...(onAbort ? { abort: onAbort } : {}),
					...(onTeamMemberOpen ? { openTeamMember: onTeamMemberOpen } : {}),
					...(subagentRuntimeId ? { subagentRuntimeId } : {}),
				},
			}),
		[
			props.sessionId,
			items,
			streaming,
			props.workspace,
			props.participants,
			props.pendingLabel,
			initialTargetKey,
			onInitialTargetHandled,
			onAbort,
			onTeamMemberOpen,
			subagentRuntimeId,
		],
	);
	return (
		<Conversation.Root feed={feed}>
			<Conversation.Viewport>
				<Conversation.Messages />
				<Conversation.Footer>{props.children}</Conversation.Footer>
				<Conversation.TimelineRail />
				<Conversation.ScrollToBottom />
			</Conversation.Viewport>
		</Conversation.Root>
	);
}
