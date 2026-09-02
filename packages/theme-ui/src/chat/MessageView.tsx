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

export interface MessageTextProps extends ComponentPropsWithoutRef<"span"> {
	readonly asChild?: boolean;
}

/** Semantic author label; may project its typography onto a caller-owned host. */
export const MessageAuthor = forwardRef<HTMLSpanElement, MessageTextProps>(function MessageAuthor(
	{ asChild = false, className, ...props },
	forwardedRef,
) {
	const Comp = asChild ? Slot.Root : "span";
	return (
		<Comp
			ref={forwardedRef}
			className={cn("text-[13px] font-semibold text-foreground/80", className)}
			{...props}
		/>
	);
});

/** Inline status cluster with the spacing contract shared by message recipes. */
export const MessageStatus = forwardRef<HTMLSpanElement, MessageTextProps>(function MessageStatus(
	{ asChild = false, className, ...props },
	forwardedRef,
) {
	const Comp = asChild ? Slot.Root : "span";
	return (
		<Comp
			ref={forwardedRef}
			className={cn("inline-flex items-center gap-1", className)}
			{...props}
		/>
	);
});

/** Secondary message metadata with a semantic inline default host. */
export const MessageMeta = forwardRef<HTMLSpanElement, MessageTextProps>(function MessageMeta(
	{ asChild = false, className, ...props },
	forwardedRef,
) {
	const Comp = asChild ? Slot.Root : "span";
	return (
		<Comp
			ref={forwardedRef}
			className={cn("text-[11px] text-muted-foreground/35", className)}
			{...props}
		/>
	);
});

export function useMessageRootContext(part: string): MessageRootContextValue {
	const context = useContext(MessageRootContext);
	if (!context) throw new Error(`${part} must be used within Message.Root`);
	return context;
}

export const Message = {
	Root: MessageRoot,
	Author: MessageAuthor,
	Status: MessageStatus,
	Meta: MessageMeta,
} as const;
