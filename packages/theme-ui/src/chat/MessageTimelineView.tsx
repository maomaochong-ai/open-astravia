import { cn } from "@vetta/ui";
import { Slot } from "radix-ui";
import {
	forwardRef,
	type ButtonHTMLAttributes,
	type ComponentPropsWithoutRef,
	type CSSProperties,
} from "react";

export interface MessageTimelinePrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

function createPrimitive(displayName: string, baseClassName: string) {
	const Primitive = forwardRef<HTMLDivElement, MessageTimelinePrimitiveProps>(function Primitive(
		{ asChild = false, className, ...props },
		forwardedRef,
	) {
		const Comp = asChild ? Slot.Root : "div";
		return <Comp ref={forwardedRef} className={cn(baseClassName, className)} {...props} />;
	});
	Primitive.displayName = displayName;
	return Primitive;
}

interface MessageTimelineSpanProps extends ComponentPropsWithoutRef<"span"> {
	readonly asChild?: boolean;
}

function createSpanPrimitive(displayName: string, baseClassName: string) {
	const Primitive = forwardRef<HTMLSpanElement, MessageTimelineSpanProps>(function Primitive(
		{ asChild = false, className, ...props },
		forwardedRef,
	) {
		const Comp = asChild ? Slot.Root : "span";
		return <Comp ref={forwardedRef} className={cn(baseClassName, className)} {...props} />;
	});
	Primitive.displayName = displayName;
	return Primitive;
}

export const MessageTimelineRoot = createPrimitive("MessageTimeline.Root", "relative");

export const MessageTimelineNavigation = forwardRef<
	HTMLElement,
	ComponentPropsWithoutRef<"nav">
>(function MessageTimelineNavigation({ className, ...props }, forwardedRef) {
	return (
		<nav
			ref={forwardedRef}
			className={cn(
				"flex w-5 flex-col items-start gap-1 transition-opacity",
				"data-[state=closed]:opacity-60 data-[state=closed]:hover:opacity-100",
				className,
			)}
			{...props}
		/>
	);
});

export interface MessageTimelineButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	readonly asChild?: boolean;
}

export const MessageTimelineTrigger = forwardRef<HTMLButtonElement, MessageTimelineButtonProps>(
	function MessageTimelineTrigger({ asChild = false, className, children, type, ...props }, forwardedRef) {
		const Comp = asChild ? Slot.Root : "button";
		return (
			<Comp
				ref={forwardedRef}
				type={asChild ? undefined : (type ?? "button")}
				className={cn(
					"-ml-[2px] flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors",
					"hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:outline-none",
					"data-[state=open]:bg-accent data-[state=open]:text-foreground",
					className,
				)}
				{...props}
			>
				{children ?? <span className="icon-[solar--inbox-archive-outline] h-3 w-3" aria-hidden />}
			</Comp>
		);
	},
);

const TICK_STEP_PX = 8;
const TICK_PAD_PX = 4;
const MAX_RAIL_HEIGHT_PX = 200;

export const MessageTimelineRail = forwardRef<
	HTMLDivElement,
	MessageTimelinePrimitiveProps & { readonly count: number }
>(function MessageTimelineRail({ asChild = false, className, count, style, ...props }, forwardedRef) {
	const Comp = asChild ? Slot.Root : "div";
	const last = Math.max(1, count - 1);
	const innerHeight = Math.min(last * TICK_STEP_PX, MAX_RAIL_HEIGHT_PX);
	return (
		<Comp
			ref={forwardedRef}
			className={cn("relative w-full", className)}
			style={{ height: innerHeight + TICK_PAD_PX * 2, ...style }}
			{...props}
		/>
	);
});

export interface MessageTimelineTickProps extends MessageTimelineButtonProps {
	readonly count: number;
	readonly index: number;
}

export const MessageTimelineTick = forwardRef<HTMLButtonElement, MessageTimelineTickProps>(
	function MessageTimelineTick(
		{ asChild = false, className, count, index, style, type, children, ...props },
		forwardedRef,
	) {
		const Comp = asChild ? Slot.Root : "button";
		const last = Math.max(1, count - 1);
		const innerHeight = Math.min(last * TICK_STEP_PX, MAX_RAIL_HEIGHT_PX);
		const positionStyle = {
			top: TICK_PAD_PX + (index / last) * innerHeight,
			...style,
		} satisfies CSSProperties;
		return (
			<Comp
				ref={forwardedRef}
				type={asChild ? undefined : (type ?? "button")}
				className={cn(
					"group absolute left-1/2 z-0 flex h-3 w-full -translate-x-1/2 -translate-y-1/2 items-center justify-start pl-1 hover:z-20 focus-visible:z-20",
					className,
				)}
				style={positionStyle}
				{...props}
			>
				<span
					className={cn(
						"h-0.5 rounded-full transition-[width,background-color] duration-150",
						"w-2 bg-muted-foreground/50 group-hover:w-6 group-hover:bg-muted-foreground/80 group-focus-visible:w-6 group-focus-visible:bg-muted-foreground/80",
						"group-aria-[current=location]:w-3 group-aria-[current=location]:bg-primary group-hover:group-aria-[current=location]:w-7 group-focus-visible:group-aria-[current=location]:w-7",
					)}
					aria-hidden
				/>
				{children}
			</Comp>
		);
	},
);

export const MessageTimelineTickPreview = createSpanPrimitive(
	"MessageTimeline.TickPreview",
	"pointer-events-none absolute left-full z-30 ml-2 w-max max-w-64 rounded-lg border border-border/50 bg-popover px-2.5 py-1.5 text-left text-[12px] leading-snug text-popover-foreground shadow-md line-clamp-3 break-words whitespace-normal opacity-0 delay-0 duration-150 transition-opacity group-hover:opacity-100 group-hover:delay-150 group-focus-visible:opacity-100 group-focus-visible:delay-0",
);
export const MessageTimelinePanelPositioner = createPrimitive(
	"MessageTimeline.PanelPositioner",
	"absolute top-1/2 left-full z-30 ml-1.5 -translate-y-1/2",
);
export const MessageTimelinePanel = createPrimitive(
	"MessageTimeline.Panel",
	"flex h-72 w-64 flex-col overflow-hidden rounded-xl border border-border/50 bg-popover shadow-md",
);
export const MessageTimelinePanelHeader = createPrimitive(
	"MessageTimeline.PanelHeader",
	"px-3 pt-2.5 pb-2",
);
export const MessageTimelinePanelHeading = createPrimitive(
	"MessageTimeline.PanelHeading",
	"mb-2 flex items-center gap-2",
);
export const MessageTimelineTitle = forwardRef<
	HTMLHeadingElement,
	ComponentPropsWithoutRef<"h2"> & { readonly asChild?: boolean }
>(function MessageTimelineTitle({ asChild = false, className, ...props }, forwardedRef) {
	const Comp = asChild ? Slot.Root : "h2";
	return (
		<Comp
			ref={forwardedRef}
			className={cn("min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80", className)}
			{...props}
		/>
	);
});
export const MessageTimelineCount = createSpanPrimitive(
	"MessageTimeline.Count",
	"text-[11px] text-muted-foreground/50",
);
export const MessageTimelineBody = createPrimitive(
	"MessageTimeline.Body",
	"min-h-0 flex-1 px-1 pb-1",
);
export const MessageTimelineEmpty = createPrimitive(
	"MessageTimeline.Empty",
	"px-2 py-2 text-[12px] text-muted-foreground",
);

export const MessageTimelineClose = forwardRef<HTMLButtonElement, MessageTimelineButtonProps>(
	function MessageTimelineClose({ asChild = false, className, children, type, ...props }, forwardedRef) {
		const Comp = asChild ? Slot.Root : "button";
		return (
			<Comp
				ref={forwardedRef}
				type={asChild ? undefined : (type ?? "button")}
				className={cn(
					"flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent/60 hover:text-foreground",
					className,
				)}
				{...props}
			>
				{children ?? <span className="icon-[solar--close-circle-linear] h-3.5 w-3.5" aria-hidden />}
			</Comp>
		);
	},
);

export const MessageTimelineEntry = forwardRef<HTMLButtonElement, MessageTimelineButtonProps>(
	function MessageTimelineEntry({ asChild = false, className, type, ...props }, forwardedRef) {
		const Comp = asChild ? Slot.Root : "button";
		return (
			<Comp
				ref={forwardedRef}
				type={asChild ? undefined : (type ?? "button")}
				className={cn(
					"flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left text-foreground/80 transition-colors",
					"hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
					"aria-[current=location]:bg-primary/15 aria-[current=location]:text-foreground",
					className,
				)}
				{...props}
			/>
		);
	},
);

export const MessageTimelineEntryPreview = createSpanPrimitive(
	"MessageTimeline.EntryPreview",
	"block w-full truncate text-[12px]",
);
export const MessageTimelineEntryMatch = createSpanPrimitive(
	"MessageTimeline.EntryMatch",
	"block w-full truncate text-[11px] text-muted-foreground/50",
);

export const MessageTimeline = {
	Root: MessageTimelineRoot,
	Navigation: MessageTimelineNavigation,
	Trigger: MessageTimelineTrigger,
	Rail: MessageTimelineRail,
	Tick: MessageTimelineTick,
	TickPreview: MessageTimelineTickPreview,
	PanelPositioner: MessageTimelinePanelPositioner,
	Panel: MessageTimelinePanel,
	PanelHeader: MessageTimelinePanelHeader,
	PanelHeading: MessageTimelinePanelHeading,
	Title: MessageTimelineTitle,
	Count: MessageTimelineCount,
	Close: MessageTimelineClose,
	Body: MessageTimelineBody,
	Empty: MessageTimelineEmpty,
	Entry: MessageTimelineEntry,
	EntryPreview: MessageTimelineEntryPreview,
	EntryMatch: MessageTimelineEntryMatch,
} as const;
