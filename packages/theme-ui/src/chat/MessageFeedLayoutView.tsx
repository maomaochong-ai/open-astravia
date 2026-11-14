import { cn } from "@astravia-org/ui/utils";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef, CSSProperties, JSX } from "react";
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
	// 消息流上下沿渐隐：滚到一半的内容在顶栏下方淡出、在输入栏上沿淡出，
	// 而不是被硬切一刀。下沿的渐隐同时承担「输入框上方的收口」。
	//
	// 沉浸式顶栏（main[data-header-overlay=true]）下顶栏浮在消息流上：静止时顶部先留出
	// 顶栏加渐隐区的高度，滚动时内容在顶栏那一段（28px）内完全隐去，再沿一条缓入缓出的曲线
	// 在约 70px 内渐显（多段色标近似 ease-in-out，线性渐变会在两端出现可见硬边）。
	// 用 mask 而不是盖一层底色：毛玻璃与自定义背景下都成立，也不需要背景模糊。
	cn(
		"min-h-0 flex-1 pt-4 [mask-image:linear-gradient(to_bottom,transparent_0,black_14px,black_calc(100%-36px),rgb(0_0_0/0.45)_calc(100%-20px),transparent_100%)]",
		// 静止时的顶部留白不能放在这个滚动容器的 padding 上：Virtuoso 的视口是
		// position:absolute; top:0; height:100%，会盖住 padding，滚到顶时第一条消息仍从窗口顶边开始。
		// 留白在列表 Header（MessageFeedLayoutTopInset）。底部（输入框上沿）同样是 32px 渐隐。
		"[[data-header-overlay=true]_&]:[mask-image:linear-gradient(to_bottom,transparent_0,transparent_28px,rgb(0_0_0/0.04)_36px,rgb(0_0_0/0.14)_46px,rgb(0_0_0/0.33)_58px,rgb(0_0_0/0.58)_70px,rgb(0_0_0/0.8)_82px,rgb(0_0_0/0.94)_92px,black_100px,black_calc(100%-32px),rgb(0_0_0/0.8)_calc(100%-24px),rgb(0_0_0/0.45)_calc(100%-16px),rgb(0_0_0/0.15)_calc(100%-8px),transparent_100%)]",
	),
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
					// 不加 overflow-hidden：宽表要能用负 margin 探出阅读栏。
					// 真正的横向裁剪由外层 Virtualizer（overflowX: hidden）在视口边界完成。
					"mx-auto flex max-w-3xl flex-col px-5 pb-8",
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

/**
 * 滚到顶时把第一条消息让出沉浸式顶栏与渐隐区。
 * 必须放在列表流里（Virtuoso Header）：滚动容器上的 padding 会被 Virtuoso 绝对定位的视口盖住，
 * 第一条消息仍会从窗口顶边开始。80px 让开顶栏（约 52px）并略高于渐隐结束线；没有沉浸式顶栏时高度为 0。
 */
export function MessageFeedLayoutTopInset(): JSX.Element {
	return (
		<div
			aria-hidden
			data-message-feed-layout-part="top-inset"
			className="h-0 shrink-0 [[data-header-overlay=true]_&]:h-[80px]"
		/>
	);
}

export const MessageFeedLayout = {
	Frame: MessageFeedLayoutFrame,
	Viewport: MessageFeedLayoutViewport,
	Virtualizer: MessageFeedLayoutVirtualizer,
	List: MessageFeedLayoutList,
	TopInset: MessageFeedLayoutTopInset,
	LeftRail: MessageFeedLayoutLeftRail,
	RailContent: MessageFeedLayoutRailContent,
	State: MessageFeedLayoutState,
} as const;
