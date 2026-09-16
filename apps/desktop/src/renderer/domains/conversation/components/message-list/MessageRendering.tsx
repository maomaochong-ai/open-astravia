import { createContext, useContext, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import type { ChatConversationItem } from "./types";
import type { MessageItemProps } from "./MessageItem";

export interface MessageRendering {
	/** A local display projection; the durable source is never mutated. */
	readonly project?: (message: ChatConversationItem) => ChatConversationItem;
	readonly renderers?: Partial<Record<ChatConversationItem["kind"], ComponentType<MessageItemProps>>>;
	readonly row?: ComponentType<MessageRowProps>;
}

export interface MessageRowProps {
	message: ChatConversationItem;
	isLast: boolean;
	children: ReactNode;
}

export function MessageRow(props: MessageRowProps) {
	const Row = useMessageRendering().row ?? DefaultMessageRow;
	return <Row {...props} />;
}

export function DefaultMessageRow({ message, isLast, children }: MessageRowProps) {
	return (
		<div
			data-entry-id={message.entryId ?? message.id}
			className={isLast && message.kind === "user" ? "pb-9" : "pb-5"}
		>
			{children}
		</div>
	);
}

const MessageRenderingContext = createContext<MessageRendering>({});

/** Projections run in order; the later renderer for a kind (or row) wins. */
export function extendMessageRendering(base: MessageRendering, extension: MessageRendering): MessageRendering {
	const first = base.project;
	const second = extension.project;
	return {
		project: first && second ? (message) => second(first(message)) : (second ?? first),
		renderers: { ...base.renderers, ...extension.renderers },
		row: extension.row ?? base.row,
	};
}

export function MessageRenderingProvider({ value, children }: { value: MessageRendering; children: ReactNode }) {
	const inherited = useMessageRendering();
	const composed = useMemo(() => extendMessageRendering(inherited, value), [inherited, value]);
	return <MessageRenderingContext.Provider value={composed}>{children}</MessageRenderingContext.Provider>;
}

/** Install a recipe without shadowing extensions supplied by its caller. */
export function MessageRenderingDefaults({ value, children }: { value: MessageRendering; children: ReactNode }) {
	const inherited = useMessageRendering();
	const composed = useMemo(() => extendMessageRendering(value, inherited), [inherited, value]);
	return <MessageRenderingContext.Provider value={composed}>{children}</MessageRenderingContext.Provider>;
}

export function useMessageRendering(): MessageRendering {
	return useContext(MessageRenderingContext);
}
