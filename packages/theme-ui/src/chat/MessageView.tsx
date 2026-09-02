import { cn } from "@vetta/ui";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { createContext, forwardRef, useContext } from "react";

export interface MessageRootProps {
	readonly pending?: boolean;
	readonly children: ReactNode;
}

interface MessageRootContextValue {
	readonly pending: boolean;
}

const MessageRootContext = createContext<MessageRootContextValue | null>(null);

/** State boundary only. The caller composes a concrete host from MessageLayout. */
export function MessageRoot({ pending = false, children }: MessageRootProps): JSX.Element {
	return <MessageRootContext.Provider value={{ pending }}>{children}</MessageRootContext.Provider>;
}

export interface MessagePrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

export const MessageAvatar = createMessagePart("Avatar");
export const MessageAuthor = createMessagePart(
	"Author",
	"text-[13px] font-semibold text-foreground/80",
);
export const MessageStatus = createMessagePart("Status", "inline-flex items-center gap-1");
export const MessageMeta = createMessagePart("Meta", "text-[11px] text-muted-foreground/35");
export const MessageAttachments = createMessagePart("Attachments");
export const MessageContent = createMessagePart("Content");
export const MessageActions = createMessagePart("Actions");
export const MessageCards = createMessagePart("Cards");

function createMessagePart(name: string, baseClassName?: string) {
	return forwardRef<HTMLDivElement, MessagePrimitiveProps>(function MessagePart(
		{ asChild = false, children, className, ...props },
		forwardedRef,
	) {
		useMessageRootContext(`Message.${name}`);
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={cn(baseClassName, className)}
				data-message-part={name.toLowerCase()}
				{...props}
			>
				{children}
			</Comp>
		);
	});
}

export function useMessageRootContext(part: string): MessageRootContextValue {
	const context = useContext(MessageRootContext);
	if (!context) throw new Error(`${part} must be used within Message.Root`);
	return context;
}

export const Message = {
	Root: MessageRoot,
	Avatar: MessageAvatar,
	Author: MessageAuthor,
	Status: MessageStatus,
	Meta: MessageMeta,
	Attachments: MessageAttachments,
	Content: MessageContent,
	Actions: MessageActions,
	Cards: MessageCards,
} as const;
