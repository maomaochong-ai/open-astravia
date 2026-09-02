import { cn } from "@vetta/ui";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { forwardRef } from "react";
import { useMessageFeedContext } from "./MessageFeedContext";

export interface MessageFeedLayoutPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

export interface MessageFeedListLayoutProps {
	readonly className?: string;
	readonly style?: CSSProperties;
}

export const MessageFeedLayoutFrame = createFeedLayoutPart(
	"Frame",
	"@container relative flex min-h-0 flex-1 flex-col",
);
export const MessageFeedLayoutViewport = createFeedLayoutPart(
	"Viewport",
	"flex min-h-0 min-w-0 flex-1 flex-col",
);
export const MessageFeedLayoutVirtualizer = createFeedLayoutPart(
	"Virtualizer",
	"flex-1 pt-2",
	{ overflowX: "hidden" },
);
export const MessageFeedLayoutLeftRail = createFeedLayoutPart(
	"LeftRail",
	"pointer-events-none absolute top-1/2 left-3 z-20 -translate-y-1/2 @max-[52rem]:hidden",
);
export const MessageFeedLayoutRailContent = createFeedLayoutPart(
	"RailContent",
	"pointer-events-auto",
);
export const MessageFeedLayoutState = createFeedLayoutPart(
	"State",
	"flex min-h-0 flex-1 flex-col",
);

/** Declares the DOM layout Virtuoso should use for its internal item list. */
export const MessageFeedLayoutList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
	function MessageFeedLayoutList({ className, style, ...props }, forwardedRef) {
		useMessageFeedContext("MessageFeedLayout.List");
		return (
			<div
				ref={forwardedRef}
				className={cn(
					"mx-auto flex max-w-3xl flex-col overflow-hidden px-5 pb-2",
					className,
				)}
				style={style}
				data-message-feed-layout-part="list"
				{...props}
			/>
		);
	},
);

function createFeedLayoutPart(
	name: string,
	baseClassName: string,
	baseStyle?: CSSProperties,
) {
	return forwardRef<HTMLDivElement, MessageFeedLayoutPrimitiveProps>(function FeedLayoutPart(
		{ asChild = false, children, className, style, ...props },
		forwardedRef,
	) {
		useMessageFeedContext(`MessageFeedLayout.${name}`);
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={cn(baseClassName, className)}
				style={{ ...baseStyle, ...style }}
				data-message-feed-root={name === "Frame" ? "" : undefined}
				data-message-feed-layout-part={name.toLowerCase()}
				{...props}
			>
				{children}
			</Comp>
		);
	});
}

export const MessageFeedLayout = {
	Frame: MessageFeedLayoutFrame,
	Viewport: MessageFeedLayoutViewport,
	Virtualizer: MessageFeedLayoutVirtualizer,
	List: MessageFeedLayoutList,
	LeftRail: MessageFeedLayoutLeftRail,
	RailContent: MessageFeedLayoutRailContent,
	State: MessageFeedLayoutState,
} as const;
