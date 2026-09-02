import { motion } from "motion/react";
import type { HTMLMotionProps, Transition } from "motion/react";
import { Slot } from "radix-ui";
import type {
	ButtonHTMLAttributes,
	ComponentPropsWithoutRef,
	JSX,
	MouseEvent,
	ReactNode,
} from "react";
import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from "react";

const HIDDEN_VISUAL_STATE = { opacity: 0, scale: 0.82, x: 14, y: 12 };
const VISIBLE_VISUAL_STATE = { opacity: 1, scale: 1, x: 0, y: 0 };
const ENTRY_TRANSITION = {
	type: "spring",
	stiffness: 520,
	damping: 24,
	mass: 0.8,
} satisfies Transition;
const TEXT_INITIAL = { filter: "blur(6px)" };
const TEXT_VISIBLE = { filter: "blur(0px)" };
const TEXT_TRANSITION = {
	duration: 0.22,
	ease: [0.25, 0.1, 0.25, 1] as const,
} satisfies Transition;
const MESSAGE_STYLE = { originX: 1, originY: 1 };
const USER_MESSAGE_COLLAPSED_LINES = 10;
const USER_MESSAGE_COLLAPSED_MAX_HEIGHT = `${USER_MESSAGE_COLLAPSED_LINES * 1.6}em`;

export type UserMessageEntryState = "static" | "hidden" | "enter";

export interface UserMessageViewLabels {
	expand: string;
	edit: string;
	fork: string;
	skillBadge: string;
	sceneBadge: string;
	branchPrev: string;
	branchNext: string;
	branchPosition: string;
	pendingEdit: string;
}

export function UserMessageText({
	contentKey,
	entryState,
	expandLabel,
	children,
}: {
	/** Stable identity of the message body; only this should reset expanded state. */
	contentKey: string;
	entryState: UserMessageEntryState;
	expandLabel: string;
	children: ReactNode;
}): JSX.Element {
	const shouldAnimateIn = entryState === "enter";
	const shouldHoldHidden = entryState === "hidden";
	const contentRef = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [canExpand, setCanExpand] = useState(false);

	const measureOverflow = useCallback(() => {
		const content = contentRef.current;
		if (!content) return;
		const fontSize = Number.parseFloat(window.getComputedStyle(content).fontSize);
		const collapsedHeight = fontSize * 1.6 * USER_MESSAGE_COLLAPSED_LINES;
		setCanExpand(content.scrollHeight > collapsedHeight + 1);
	}, []);

	// Expand is sticky for the lifetime of this mount (session switch / refresh remounts).
	// Do not key off `children` — parent re-renders recreate that node (e.g. action hover).
	useLayoutEffect(() => {
		setExpanded(false);
	}, [contentKey]);

	useLayoutEffect(() => {
		measureOverflow();
		const content = contentRef.current;
		if (!content) return;
		const observer = new ResizeObserver(measureOverflow);
		observer.observe(content);
		return () => observer.disconnect();
	}, [measureOverflow, contentKey, children]);

	return (
		<div
			className="relative min-w-0 max-w-full overflow-hidden"
			style={{ maxHeight: expanded ? undefined : USER_MESSAGE_COLLAPSED_MAX_HEIGHT }}
		>
			{/* 静态态不挂 motion：历史消息与发送后常驻的气泡占绝大多数，
			    给每条都套一层动画组件只是白付出订阅与逐帧调度的开销。 */}
			{shouldAnimateIn || shouldHoldHidden ? (
				<motion.div
					ref={contentRef}
					className="min-w-0 max-w-full"
					initial={shouldAnimateIn ? TEXT_INITIAL : false}
					animate={shouldHoldHidden ? TEXT_INITIAL : TEXT_VISIBLE}
					transition={TEXT_TRANSITION}
				>
					{children}
				</motion.div>
			) : (
				<div ref={contentRef} className="min-w-0 max-w-full">
					{children}
				</div>
			)}
			{canExpand && !expanded && (
				<div className="absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t from-secondary via-secondary/80 to-secondary/0 pb-1.5">
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[12px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground"
					>
						<span className="icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5" />
						<span>{expandLabel}</span>
					</button>
				</div>
			)}
		</div>
	);
}

export function SkillBadgeView({
	name,
	type = "skill",
	skillLabel,
	sceneLabel,
}: {
	name: string;
	type?: "skill" | "scene";
	skillLabel: string;
	sceneLabel: string;
}): JSX.Element {
	const icon =
		type === "scene" ? "icon-[solar--clapperboard-open-linear]" : "icon-[solar--magic-stick-linear]";
	const label = type === "scene" ? sceneLabel : skillLabel;
	return (
		<span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">
			<span className={`${icon} h-3 w-3`} />
			<span className="text-primary/75">{label}</span>
			{name}
		</span>
	);
}

export function SettingsAssistBadgeView({ label }: { label: string }): JSX.Element {
	return (
		<span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">
			<span className="icon-[solar--settings-linear] h-3 w-3" />
			{label}
		</span>
	);
}

const actionBtnClass =
	"inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

export const UserMessageAction = forwardRef<
	HTMLButtonElement,
	ButtonHTMLAttributes<HTMLButtonElement> & { readonly asChild?: boolean }
>(function UserMessageAction({ asChild = false, className, type, ...props }, forwardedRef) {
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			ref={forwardedRef}
			type={asChild ? undefined : (type ?? "button")}
			className={`${actionBtnClass} ${className ?? ""}`}
			{...props}
		/>
	);
});

/**
 * 气泡外框。
 *
 * 只有「正在入场 / 入场前挂起」的那一条才需要 motion；其余（历史消息、发送完成
 * 后的常驻气泡）走普通 div。列表里静态气泡是绝大多数，让它们各自挂一个动画组件
 * 会在每次列表重渲时付出订阅与逐帧调度成本，而屏幕上并没有任何东西在动。
 */
export function UserMessageFrame({
	entryState,
	onEntryComplete,
	onContextMenu,
	onActionsVisibleChange,
	children,
	className,
	onMouseEnter,
	onMouseLeave,
	style,
	...divProps
}: ComponentPropsWithoutRef<"div"> & {
	entryState: UserMessageEntryState;
	onEntryComplete?: () => void;
	onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
	onActionsVisibleChange: (visible: boolean) => void;
	children: ReactNode;
}): JSX.Element {
	const shouldAnimateIn = entryState === "enter";
	const shouldHoldHidden = entryState === "hidden";
	const handlers = {
		onContextMenu,
		onMouseEnter: (event: MouseEvent<HTMLDivElement>) => {
			onMouseEnter?.(event);
			if (!event.defaultPrevented) onActionsVisibleChange(true);
		},
		onMouseLeave: (event: MouseEvent<HTMLDivElement>) => {
			onMouseLeave?.(event);
			if (!event.defaultPrevented) onActionsVisibleChange(false);
		},
	};
	if (!shouldAnimateIn && !shouldHoldHidden) {
		return (
			<div className={className} style={style} {...divProps} {...handlers}>
				{children}
			</div>
		);
	}
	return (
		<motion.div
			className={className}
			initial={shouldAnimateIn ? HIDDEN_VISUAL_STATE : false}
			animate={shouldHoldHidden ? HIDDEN_VISUAL_STATE : VISIBLE_VISUAL_STATE}
			transition={ENTRY_TRANSITION}
			onAnimationComplete={shouldAnimateIn ? onEntryComplete : undefined}
			style={{ ...MESSAGE_STYLE, ...style }}
			{...(divProps as HTMLMotionProps<"div">)}
			{...handlers}
		>
			{children}
		</motion.div>
	);
}

export const UserMessage = {
	Frame: UserMessageFrame,
	Text: UserMessageText,
	Action: UserMessageAction,
	SkillBadge: SkillBadgeView,
	SettingsAssistBadge: SettingsAssistBadgeView,
} as const;
