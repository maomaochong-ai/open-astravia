import { cn } from "@vetta/ui";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { Slot } from "radix-ui";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

const INDICATOR_INITIAL = { opacity: 0, y: 6 };
const INDICATOR_ANIMATE = { opacity: 1, y: 0 };
const INDICATOR_EXIT = { opacity: 0, y: 6 };
const INDICATOR_TRANSITION = {
	duration: 0.25,
	ease: [0.25, 0.1, 0.25, 1] as const,
} satisfies Transition;

export interface MessageListFooterPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

export const MessageListFooterRoot = forwardRef<
	HTMLDivElement,
	MessageListFooterPrimitiveProps
>(function MessageListFooterRoot({ asChild = false, className, ...props }, forwardedRef) {
	const Comp = asChild ? Slot.Root : "div";
	return (
		<Comp
			ref={forwardedRef}
			className={cn("mx-auto flex max-w-3xl flex-col gap-2 px-5 pt-0", className)}
			{...props}
		/>
	);
});

export function MessageListFooterPresence({ children }: { readonly children: ReactNode }): JSX.Element {
	return <AnimatePresence initial={false}>{children}</AnimatePresence>;
}

export function MessageListFooterPending({ label }: { readonly label: string }): JSX.Element {
	return (
		<motion.div
			initial={INDICATOR_INITIAL}
			animate={INDICATOR_ANIMATE}
			exit={INDICATOR_EXIT}
			transition={INDICATOR_TRANSITION}
			className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground"
		>
			<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
			<span>{label}</span>
		</motion.div>
	);
}

export function MessageListFooterCompacting({ label }: { readonly label: string }): JSX.Element {
	return (
		<motion.div
			initial={INDICATOR_INITIAL}
			animate={INDICATOR_ANIMATE}
			exit={INDICATOR_EXIT}
			transition={INDICATOR_TRANSITION}
			className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
		>
			<svg width={14} height={14} style={{ animation: "context-ring-spin 1s linear infinite" }}>
				<circle
					cx={7}
					cy={7}
					r={5}
					fill="none"
					stroke="currentColor"
					strokeWidth={1}
					opacity={0.3}
					className="text-muted-foreground"
				/>
				<circle
					cx={7}
					cy={7}
					r={5}
					fill="none"
					stroke="currentColor"
					strokeWidth={1}
					strokeDasharray={`${Math.PI * 5 * 0.25} ${Math.PI * 5 * 0.75}`}
					strokeLinecap="round"
					className="text-amber-500"
				/>
			</svg>
			<span className="text-[12px] text-amber-500/80">{label}</span>
		</motion.div>
	);
}

export function MessageListFooterRetry({
	detail,
	label,
}: {
	readonly detail?: string | null;
	readonly label: string;
}): JSX.Element {
	return (
		<motion.div
			initial={INDICATOR_INITIAL}
			animate={INDICATOR_ANIMATE}
			exit={INDICATOR_EXIT}
			transition={INDICATOR_TRANSITION}
			className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
		>
			<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/60" />
			<span className="min-w-0">
				<span className="block text-[12px] text-foreground/80">{label}</span>
				{detail ? <span className="block truncate text-[11px] text-muted-foreground/70">{detail}</span> : null}
			</span>
		</motion.div>
	);
}

export const MessageListFooterWaiting = forwardRef<
	HTMLDivElement,
	MessageListFooterPrimitiveProps
>(function MessageListFooterWaiting({ asChild = false, className, ...props }, forwardedRef) {
	const Comp = asChild ? Slot.Root : "div";
	return <Comp ref={forwardedRef} className={cn("flex items-center", className)} {...props} />;
});

export const MessageListFooter = {
	Root: MessageListFooterRoot,
	Presence: MessageListFooterPresence,
	Pending: MessageListFooterPending,
	Compacting: MessageListFooterCompacting,
	Retry: MessageListFooterRetry,
	Waiting: MessageListFooterWaiting,
} as const;
