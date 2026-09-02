import { cn } from "@vetta/ui";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef } from "react";
import { createContext, forwardRef, useContext } from "react";
import { useMessageRootContext } from "./MessageView";

export type MessageLayoutKind = "incoming" | "outgoing" | "event";

const MessageLayoutContext = createContext<MessageLayoutKind | null>(null);

export interface MessageLayoutPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

const MESSAGE_LAYOUT_CLASSES: Record<MessageLayoutKind, string> = {
	incoming: "relative flex min-w-0 flex-col overflow-visible rounded-xl",
	outgoing: "flex min-w-0 justify-end",
	event: "flex justify-center px-4 py-1",
};

function createMessageLayoutHost(kind: MessageLayoutKind) {
	return forwardRef<HTMLDivElement, MessageLayoutPrimitiveProps>(function MessageLayoutHost(
		{ asChild = false, children, className, ...props },
		forwardedRef,
	) {
		const { pending } = useMessageRootContext(`MessageLayout.${kind}`);
		const Comp = asChild ? Slot.Root : "div";
		return (
			<MessageLayoutContext.Provider value={kind}>
				<Comp
					ref={forwardedRef}
					className={cn(MESSAGE_LAYOUT_CLASSES[kind], className)}
					data-message-root=""
					data-message-layout={kind}
					data-message-variant={kind}
					data-pending={pending || undefined}
					{...props}
				>
					{children}
				</Comp>
			</MessageLayoutContext.Provider>
		);
	});
}

export const MessageLayoutIncoming = createMessageLayoutHost("incoming");
export const MessageLayoutOutgoing = createMessageLayoutHost("outgoing");
export const MessageLayoutEvent = createMessageLayoutHost("event");

export const MessageLayoutIncomingSurface = createMessageLayoutPart(
	"IncomingSurface",
	"relative z-10 flex flex-col rounded-[inherit]",
	"incoming",
);
export const MessageLayoutOutgoingContent = createMessageLayoutPart(
	"OutgoingContent",
	"relative flex min-w-0 max-w-[72%] flex-col items-end",
	"outgoing",
);
export const MessageLayoutHeader = createMessageLayoutPart(
	"Header",
	"mb-2 flex items-center gap-2",
	"incoming",
);
export const MessageLayoutHeaderLeading = createMessageLayoutPart(
	"HeaderLeading",
	"shrink-0",
	"incoming",
);
export const MessageLayoutBeforeBody = createMessageLayoutPart(
	"BeforeBody",
	"mb-1.5 flex max-w-full flex-wrap justify-end gap-1.5",
	"outgoing",
);
export const MessageLayoutFooter = createMessageLayoutPartByKind("Footer", {
	incoming: "mt-2 flex items-center",
	outgoing: "mt-1 flex",
});
export const MessageLayoutAfterBody = createMessageLayoutPart(
	"AfterBody",
	"mt-2",
	"incoming",
);

function createMessageLayoutPart(
	name: string,
	baseClassName: string,
	requiredKind: MessageLayoutKind,
) {
	return forwardRef<HTMLDivElement, MessageLayoutPrimitiveProps>(function MessageLayoutPart(
		{ asChild = false, children, className, ...props },
		forwardedRef,
	) {
		const kind = useContext(MessageLayoutContext);
		if (kind !== requiredKind) {
			throw new Error(
				`MessageLayout.${name} must be used within MessageLayout.${capitalize(requiredKind)}`,
			);
		}
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={cn(baseClassName, className)}
				data-message-layout-part={name.toLowerCase()}
				{...props}
			>
				{children}
			</Comp>
		);
	});
}

function createMessageLayoutPartByKind(
	name: string,
	classes: Partial<Record<MessageLayoutKind, string>>,
) {
	return forwardRef<HTMLDivElement, MessageLayoutPrimitiveProps>(function MessageLayoutPart(
		{ asChild = false, children, className, ...props },
		forwardedRef,
	) {
		const kind = useContext(MessageLayoutContext);
		const baseClassName = kind ? classes[kind] : undefined;
		if (!kind || !baseClassName) {
			throw new Error(`MessageLayout.${name} is not available in the current message layout`);
		}
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={cn(baseClassName, className)}
				data-message-layout-part={name.toLowerCase()}
				{...props}
			>
				{children}
			</Comp>
		);
	});
}

function capitalize(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export const MessageLayout = {
	Incoming: MessageLayoutIncoming,
	IncomingSurface: MessageLayoutIncomingSurface,
	Outgoing: MessageLayoutOutgoing,
	OutgoingContent: MessageLayoutOutgoingContent,
	Event: MessageLayoutEvent,
	Header: MessageLayoutHeader,
	HeaderLeading: MessageLayoutHeaderLeading,
	BeforeBody: MessageLayoutBeforeBody,
	Footer: MessageLayoutFooter,
	AfterBody: MessageLayoutAfterBody,
} as const;
