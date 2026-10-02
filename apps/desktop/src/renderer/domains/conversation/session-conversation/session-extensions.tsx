import type { ConversationUserMessageViewModel } from "@shared/conversation";
import { activeSessionAtom, isCompactingAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { type ReactNode, useMemo } from "react";
import { AnnotationMessageMarker } from "../components/annotations/AnnotationMenus";
import { AnnotationScope } from "../components/annotations/AnnotationScope";
import { ForkOriginBanner, resolveForkOriginPlacement } from "./ForkOriginBanner";
import { MessageListFooter } from "./MessageListFooter";
import { SessionSelection } from "../components/message-list/SessionSelection";
import {
	type ConversationRowDecoratorProps,
	useConversationExtension,
	useConversationExtensionValue,
	useConversationFeed,
	useMessage,
} from "../conversation-view";

/**
 * Saved annotations of the shown session. Its panel survives virtualized rows,
 * so it wraps the viewport; it is inert while another session is shown. The
 * wrapper is the same element either way: changing which session is active
 * must never remount the message list.
 */
export function SessionAnnotations({ children }: { readonly children: ReactNode }) {
	const feed = useConversationFeed("SessionAnnotations");
	const session = useAtomValue(activeSessionAtom);
	const items = useAtomValue(feed.items);
	const sourceEntryIds = useMemo(
		() => items.flatMap((message) => (message.entryId ? [message.entryId] : [])),
		[items],
	);
	return (
		<AnnotationScope session={session?.sessionPath === feed.key ? session : null} sourceEntryIds={sourceEntryIds}>
			{children}
		</AnnotationScope>
	);
}

/** Context menu on selected message text: send to the composer, or ask about it. */
export function SessionSelectionMenu({ children }: { readonly children: ReactNode }) {
	return <SessionSelection>{children}</SessionSelection>;
}

/** Saved-annotation marker for the message of the enclosing template. */
export function AnnotationMarker() {
	return <AnnotationMessageMarker message={useMessage("AnnotationMarker")} />;
}

function AgentAnnotationRow({ message, children }: ConversationRowDecoratorProps) {
	return (
		<div className="group/annotation relative">
			{children}
			{message.kind === "agent" ? (
				<div className="pointer-events-none absolute right-0 top-0 opacity-0 group-hover/annotation:pointer-events-auto group-hover/annotation:opacity-100 group-focus-within/annotation:pointer-events-auto group-focus-within/annotation:opacity-100">
					<AnnotationMessageMarker message={message} />
				</div>
			) : null}
		</div>
	);
}

/** Shows a reply's saved annotations on hover at its top-right corner. */
export function AgentAnnotationMarkers() {
	useConversationExtension(useMemo(() => ({ id: "agent-annotation-markers", decorateRow: AgentAnnotationRow }), []));
	return null;
}

/**
 * "Forked from" banner under the reply of the turn this session was forked at.
 * The anchor follows the messages, so the banner moves with history changes.
 */
export function ForkOriginExtension() {
	const feed = useConversationFeed("ForkOriginExtension");
	const session = useAtomValue(activeSessionAtom);
	const items = useAtomValue(feed.items);
	const placement = useMemo(
		() => resolveForkOriginPlacement(items, session?.parentEntryId, Boolean(session?.parentSessionPath)),
		[items, session?.parentEntryId, session?.parentSessionPath],
	);
	const anchorId = placement ? items[placement.anchorIndex]?.id : undefined;
	const source = placement ? items[placement.sourceUserIndex] : undefined;
	const sourceMessage = source?.kind === "user" ? source : undefined;
	const value = useMemo<ForkOriginAnchor | undefined>(
		() => (anchorId ? { anchorId, sourceMessage } : undefined),
		[anchorId, sourceMessage],
	);
	useConversationExtension(useMemo(() => ({ id: FORK_ORIGIN, decorateRow: ForkOriginRow, value }), [value]));
	return null;
}

const FORK_ORIGIN = "fork-origin";

interface ForkOriginAnchor {
	readonly anchorId: string;
	readonly sourceMessage?: ConversationUserMessageViewModel;
}

/** A stable row decorator: the anchor arrives as the extension's value, so rows never remount. */
function ForkOriginRow({ message, children }: ConversationRowDecoratorProps) {
	const anchor = useConversationExtensionValue<ForkOriginAnchor>(FORK_ORIGIN);
	return (
		<>
			{children}
			{message.id === anchor?.anchorId ? <ForkOriginBanner sourceMessage={anchor.sourceMessage} /> : null}
		</>
	);
}

/** Waiting and compaction states after the newest message. */
export function SessionWaitingFooter() {
	const feed = useConversationFeed("SessionWaitingFooter");
	const items = useAtomValue(feed.items);
	const isStreaming = useAtomValue(feed.streaming);
	const isCompacting = useAtomValue(isCompactingAtom);
	return (
		<MessageListFooter
			isCompacting={isCompacting}
			waiting={isStreaming && items.at(-1)?.kind !== "agent"}
			sessionId={feed.key ?? undefined}
			pendingLabel={feed.pendingLabel}
		/>
	);
}
