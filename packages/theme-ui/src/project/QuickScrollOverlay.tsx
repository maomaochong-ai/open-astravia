import { cn } from "@vetta/ui";
import {
	type CSSProperties,
	type JSX,
	type ReactNode,
	useEffect,
	useState,
} from "react";

/** Content must overflow at least this much before rails appear. */
const MIN_OVERFLOW = 240;
/** Distance from an edge that counts as "at edge" (hide that side's rail). */
const EDGE_THRESHOLD = 8;
/** Expanded rail height (px). Collapse animates to 0. */
const RAIL_HEIGHT_PX = 18;

export interface QuickScrollLabels {
	bottom: string;
	top: string;
}

export interface QuickScrollOverlayProps {
	children: ReactNode;
	className?: string;
	labels: QuickScrollLabels;
	scrollElement: HTMLElement | null;
	style?: CSSProperties;
}

interface QuickScrollVisibility {
	showBottom: boolean;
	showTop: boolean;
}

const HIDDEN: QuickScrollVisibility = { showBottom: false, showTop: false };

/**
 * Layout rails above/below a scroll list (not a floating overlay).
 * Each rail collapses its height to 0 when the viewport is at that edge,
 * so the list reclaims space with a smooth transition.
 */
export function QuickScrollOverlay({
	children,
	className,
	labels,
	scrollElement,
	style,
}: QuickScrollOverlayProps): JSX.Element {
	const [visibility, setVisibility] = useState<QuickScrollVisibility>(HIDDEN);

	useEffect(() => {
		if (!scrollElement) {
			setVisibility(HIDDEN);
			return;
		}

		const sync = () => {
			const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
			const enabled = maxScrollTop > MIN_OVERFLOW;
			const next: QuickScrollVisibility = {
				showBottom: enabled && maxScrollTop - scrollElement.scrollTop > EDGE_THRESHOLD,
				showTop: enabled && scrollElement.scrollTop > EDGE_THRESHOLD,
			};
			setVisibility((current) =>
				current.showBottom === next.showBottom && current.showTop === next.showTop
					? current
					: next,
			);
		};

		// 观察者回调合帧：DOM 高频变动（虚拟列表换页、折叠动画）时每帧至多读一次布局，
		// 避免「回调强制 layout → 又触发观察者」的自激循环。
		let frame: number | null = null;
		const scheduleSync = () => {
			if (frame !== null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				sync();
			});
		};

		sync();
		scrollElement.addEventListener("scroll", scheduleSync, { passive: true });

		const resizeObserver = new ResizeObserver(scheduleSync);
		const observeChildren = () => {
			resizeObserver.disconnect();
			resizeObserver.observe(scrollElement);
			for (const child of scrollElement.children) {
				resizeObserver.observe(child);
			}
		};
		// 只监听直接子节点增删；深层内容的尺寸变化由子节点上的 ResizeObserver 覆盖，
		// 不再用 subtree 监听把整棵列表的每次行级变动都变成回调。
		const mutationObserver = new MutationObserver(() => {
			observeChildren();
			scheduleSync();
		});

		observeChildren();
		mutationObserver.observe(scrollElement, { childList: true });
		window.addEventListener("resize", scheduleSync);

		return () => {
			if (frame !== null) cancelAnimationFrame(frame);
			mutationObserver.disconnect();
			resizeObserver.disconnect();
			scrollElement.removeEventListener("scroll", scheduleSync);
			window.removeEventListener("resize", scheduleSync);
		};
	}, [scrollElement]);

	const scrollTo = (top: number) => {
		if (!scrollElement) return;
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		scrollElement.scrollTo({ behavior: reduceMotion ? "auto" : "smooth", top });
	};

	return (
		<div className={cn("flex min-h-0 flex-col overflow-hidden", className)} style={style}>
			<QuickScrollRail
				edge="top"
				label={labels.top}
				visible={visibility.showTop}
				onClick={() => scrollTo(0)}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
			<QuickScrollRail
				edge="bottom"
				label={labels.bottom}
				visible={visibility.showBottom}
				onClick={() => scrollTo(scrollElement?.scrollHeight ?? 0)}
			/>
		</div>
	);
}

interface QuickScrollRailProps {
	edge: "bottom" | "top";
	label: string;
	onClick: () => void;
	visible: boolean;
}

function QuickScrollRail({ edge, label, onClick, visible }: QuickScrollRailProps): JSX.Element {
	// Animate the wrapper height so the list flex area grows/shrinks with the rail.
	// The button keeps a fixed paint height and is clipped while collapsing.
	// Visual language: edge affordance only — no card chrome (border/radius/fill/blur).
	// Matches sidebar list density: muted chevron + soft hover wash, same as session rows.
	return (
		<div
			aria-hidden={!visible}
			className={cn(
				"shrink-0 overflow-hidden",
				"transition-[height,opacity] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
				"motion-reduce:transition-none",
				visible ? "opacity-100" : "opacity-0",
			)}
			style={{ height: visible ? RAIL_HEIGHT_PX : 0 }}
		>
			<button
				type="button"
				aria-label={label}
				tabIndex={visible ? 0 : -1}
				disabled={!visible}
				className={cn(
					"flex w-full items-center justify-center",
					"text-muted-foreground/35",
					"transition-colors duration-150",
					"hover:bg-accent/40 hover:text-muted-foreground/70",
					"disabled:pointer-events-none",
				)}
				style={{ height: RAIL_HEIGHT_PX }}
				onClick={onClick}
			>
				<span
					aria-hidden="true"
					className={cn(
						"h-3 w-3",
						edge === "top"
							? "icon-[solar--alt-arrow-up-linear]"
							: "icon-[solar--alt-arrow-down-linear]",
					)}
				/>
			</button>
		</div>
	);
}
