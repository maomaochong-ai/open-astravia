import { cn } from "@vetta/ui";
import { AnimatePresence, motion } from "motion/react";
import {
	createContext,
	forwardRef,
	type ComponentPropsWithoutRef,
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";
import { ResizeHandle } from "../layout/ResizeHandle";

interface ActivityPanelContextValue {
	readonly displayedWidth: number;
	readonly isOpen: boolean;
	readonly isResizing: boolean;
	readonly close: () => void;
	readonly resize: (delta: number) => void;
	readonly resizeEnd: () => void;
	readonly resizeStart: () => void;
}

const ActivityPanelContext = createContext<ActivityPanelContextValue | null>(null);

export interface ActivityPanelRootProps {
	readonly children: ReactNode;
	readonly isOpen: boolean;
	readonly isResizing?: boolean;
	readonly width: number;
	readonly minWidth: number;
	readonly maxWidth: number;
	readonly onOpenChange: (open: boolean) => void;
	readonly onResizeStart?: () => void;
	/** Reports the absolute live width while the local shell follows the pointer. */
	readonly onResize?: (width: number) => void;
	readonly onResizeEnd?: (width: number) => void;
}

/** Owns controlled panel state and resize behavior. Layout remains explicit children. */
export function ActivityPanelRoot({
	children,
	isOpen,
	isResizing = false,
	width,
	minWidth,
	maxWidth,
	onOpenChange,
	onResizeStart,
	onResize,
	onResizeEnd,
}: ActivityPanelRootProps): JSX.Element {
	const liveWidthRef = useRef(width);
	const [liveWidth, setLiveWidth] = useState(width);
	const [locallyResizing, setLocallyResizing] = useState(false);
	const resizeBoundsRef = useRef({ minWidth, maxWidth });
	resizeBoundsRef.current = { minWidth, maxWidth };

	const resizeStart = useCallback((): void => {
		liveWidthRef.current = width;
		setLiveWidth(width);
		setLocallyResizing(true);
		onResizeStart?.();
	}, [onResizeStart, width]);
	const resize = useCallback(
		(delta: number): void => {
			const bounds = resizeBoundsRef.current;
			const nextWidth = Math.min(
				bounds.maxWidth,
				Math.max(bounds.minWidth, liveWidthRef.current + delta),
			);
			if (nextWidth === liveWidthRef.current) return;
			liveWidthRef.current = nextWidth;
			setLiveWidth(nextWidth);
			onResize?.(nextWidth);
		},
		[onResize],
	);
	const resizeEnd = useCallback((): void => {
		const finalWidth = liveWidthRef.current;
		onResizeEnd?.(finalWidth);
		setLocallyResizing(false);
	}, [onResizeEnd]);
	const close = useCallback(() => onOpenChange(false), [onOpenChange]);

	return (
		<ActivityPanelContext.Provider
			value={{
				close,
				displayedWidth: locallyResizing ? liveWidth : width,
				isOpen,
				isResizing: locallyResizing || isResizing,
				resize,
				resizeEnd,
				resizeStart,
			}}
		>
			{children}
		</ActivityPanelContext.Provider>
	);
}

export interface ActivityPanelDesktopProps extends ComponentPropsWithoutRef<"aside"> {
	/** The host decides whether desktop layout applies at the current breakpoint. */
	readonly present?: boolean;
}

/** Desktop width boundary. Callers explicitly compose Surface and ResizeHandle inside it. */
export const ActivityPanelDesktop = forwardRef<HTMLElement, ActivityPanelDesktopProps>(
	function ActivityPanelDesktop(
		{ present = true, className, children, style, ...props },
		forwardedRef,
	) {
		const { displayedWidth, isOpen, isResizing } = useActivityPanelContext("Desktop");
		if (!present) return null;
		return (
			<aside
				ref={forwardedRef}
				className={cn(
					"relative flex h-full min-h-0 shrink-0 flex-col overflow-visible",
					className,
				)}
				style={{
					...style,
					width: isOpen ? displayedWidth : 0,
					transition: isResizing ? "none" : "width 0.2s ease-in-out",
				}}
				{...props}
			>
				{children}
			</aside>
		);
	},
);

export interface ActivityPanelSurfaceProps extends ComponentPropsWithoutRef<"div"> {}

/** Visual content surface whose mount lifetime is independent from open/closed state. */
export const ActivityPanelSurface = forwardRef<HTMLDivElement, ActivityPanelSurfaceProps>(
	function ActivityPanelSurface({ className, children, style, ...props }, forwardedRef) {
		const { displayedWidth, isOpen } = useActivityPanelContext("Surface");
		return (
			<div
				ref={forwardedRef}
				aria-hidden={!isOpen}
				className={cn(
					"flex h-full min-h-0 flex-col transition-opacity duration-150",
					isOpen ? "opacity-100" : "pointer-events-none opacity-0",
					className,
				)}
				style={{ ...style, width: displayedWidth }}
				{...props}
			>
				{children}
			</div>
		);
	},
);

export interface ActivityPanelHeaderProps extends ComponentPropsWithoutRef<"div"> {}

export const ActivityPanelHeader = forwardRef<HTMLDivElement, ActivityPanelHeaderProps>(
	function ActivityPanelHeader({ className, ...props }, forwardedRef) {
		return (
			<div
				ref={forwardedRef}
				className={cn(
					"group/activity-tabs relative z-20 flex shrink-0 items-end pt-1",
					className,
				)}
				{...props}
			/>
		);
	},
);

export interface ActivityPanelBodyProps extends ComponentPropsWithoutRef<"div"> {}

export const ActivityPanelBody = forwardRef<HTMLDivElement, ActivityPanelBodyProps>(
	function ActivityPanelBody({ className, ...props }, forwardedRef) {
		return (
			<div
				ref={forwardedRef}
				className={cn("flex min-h-0 flex-1 flex-col", className)}
				{...props}
			/>
		);
	},
);

export function ActivityPanelResizeHandle(): JSX.Element | null {
	const { isOpen, resize, resizeEnd, resizeStart } = useActivityPanelContext("ResizeHandle");
	if (!isOpen) return null;
	return (
		<ResizeHandle
			side="left"
			onResizeStart={resizeStart}
			onResize={resize}
			onResizeEnd={resizeEnd}
		/>
	);
}

export interface ActivityPanelSheetProps extends ComponentPropsWithoutRef<typeof motion.div> {
	/** The host decides whether sheet layout applies at the current breakpoint. */
	readonly present?: boolean;
	readonly backdropClassName?: string;
}

/** Responsive sheet recipe with an explicit child tree and shared Root close behavior. */
export function ActivityPanelSheet({
	present = true,
	backdropClassName,
	className,
	children,
	...props
}: ActivityPanelSheetProps): JSX.Element {
	const { close, isOpen } = useActivityPanelContext("Sheet");
	return (
		<AnimatePresence>
			{present && isOpen ? (
				<>
					<motion.div
						key="activity-sheet-backdrop"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
						onClick={close}
						className={cn("fixed inset-0 z-40 bg-black/25", backdropClassName)}
					/>
					<motion.div
						key="activity-sheet"
						initial={{ y: "100%" }}
						animate={{ y: 0 }}
						exit={{ y: "100%" }}
						transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
						className={cn(
							"fixed inset-x-0 bottom-0 top-16 z-50 flex flex-col rounded-t-2xl border-t border-border bg-background p-2 shadow-2xl shadow-black/40",
							className,
						)}
						{...props}
					>
						{children}
					</motion.div>
				</>
			) : null}
		</AnimatePresence>
	);
}

function useActivityPanelContext(part: string): ActivityPanelContextValue {
	const context = useContext(ActivityPanelContext);
	if (!context) throw new Error(`ActivityPanel.${part} must be used within ActivityPanel.Root`);
	return context;
}

/** Compound primitives for composing host-specific activity workspaces. */
export const ActivityPanel = {
	Root: ActivityPanelRoot,
	Desktop: ActivityPanelDesktop,
	Surface: ActivityPanelSurface,
	Header: ActivityPanelHeader,
	Body: ActivityPanelBody,
	ResizeHandle: ActivityPanelResizeHandle,
	Sheet: ActivityPanelSheet,
} as const;
