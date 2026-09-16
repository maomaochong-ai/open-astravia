import { activeSessionAtom, isCompactingAtom, pendingScrollToEntryAtom } from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import { createContext, useCallback, useContext, useMemo } from "react";
import { SessionSelection } from "./message-list/SessionSelection";
import type { ConversationUserMessageViewModel } from "@shared/conversation";
import { MessageList } from "./MessageList";
import { MessageListFooter } from "./message-list/MessageListFooter";
import { MessageRenderingDefaults, DefaultMessageRow } from "./message-list/MessageRendering";
import type { MessageRowProps } from "./message-list/MessageRendering";
import { ForkOriginBanner, resolveForkOriginPlacement } from "./message-list/ForkOriginBanner";
import type { MessageRendering } from "./message-list/MessageRendering";
import { SessionUserMessage } from "./message-list/SessionUserMessage";
import { SuggestionBubbles } from "./SuggestionBubbles";
import type { MessageListProps } from "./message-list/types";

const sessionRendering: MessageRendering = {
	row: SessionMessageRow,
	renderers: {
		user: (props) =>
			props.message.kind === "user" ? <SessionUserMessage {...props} message={props.message} /> : null,
	},
};

const ForkContext = createContext<{ anchorId?: string; source?: ConversationUserMessageViewModel }>({});
function SessionMessageRow(props: MessageRowProps) {
	const fork = useContext(ForkContext);
	const showFork = fork.anchorId === props.message.id;
	return (
		<DefaultMessageRow {...props} isLast={props.isLast && !showFork}>
			{props.children}
			{showFork ? <ForkOriginBanner sourceMessage={fork.source} /> : null}
		</DefaultMessageRow>
	);
}

/** Ordinary-session recipe. Other feeds do not inherit its commands or runtime state. */
export function SessionMessageList(props: MessageListProps & { onSend?: (overrideText?: string) => Promise<void> }) {
	const session = useAtomValue(activeSessionAtom);
	const isCompacting = useAtomValue(isCompactingAtom);
	const [pendingTarget, setPendingTarget] = useAtom(pendingScrollToEntryAtom);
	const clearPendingTarget = useCallback(() => setPendingTarget(null), [setPendingTarget]);
	const fork = useMemo(() => {
		const placement = resolveForkOriginPlacement(
			props.messages,
			session?.parentEntryId,
			Boolean(session?.parentSessionPath),
		);
		const source = placement ? props.messages[placement.sourceUserIndex] : undefined;
		return {
			anchorId: placement ? props.messages[placement.anchorIndex]?.id : undefined,
			source: source?.kind === "user" ? source : undefined,
		};
	}, [props.messages, session?.parentEntryId, session?.parentSessionPath]);
	return (
		<ForkContext.Provider value={fork}>
			<MessageRenderingDefaults value={sessionRendering}>
				<SessionSelection>
					<MessageList
						{...props}
						initialTargetKey={pendingTarget?.entryId}
						onInitialTargetHandled={clearPendingTarget}
					>
						<MessageListFooter
							isCompacting={isCompacting}
							waiting={props.isStreaming && props.messages.at(-1)?.kind !== "agent"}
							sessionId={props.sessionId ?? undefined}
							pendingLabel={props.pendingLabel}
						/>
						{props.onSend ? <SuggestionBubbles onSend={props.onSend} /> : null}
						{props.children}
					</MessageList>
				</SessionSelection>
			</MessageRenderingDefaults>
		</ForkContext.Provider>
	);
}
