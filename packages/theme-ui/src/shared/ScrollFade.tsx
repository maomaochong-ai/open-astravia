import {
	type CSSProperties,
	type HTMLAttributes,
	type JSX,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";

/** Default fade height (px) at the bottom edge when more content is below. */
const DEFAULT_FADE_SIZE = 28;

export interface ScrollFadeProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
	children: ReactNode;
	/** Callback ref for the scroll element (e.g. Virtuoso customScrollParent). */
	onScrollRef?: (el: HTMLDivElement | null) => void;
	/** Bottom fade height in px. Default 28. */
	fadeSize?: number;
}

/**
 * Scroll container that applies a bottom edge fade (via mask-image) when content
 * overflows and the user is not scrolled to the bottom — a scroll affordance
 * without showing a scrollbar.
 */
export function ScrollFade({
	children,
	className,
	fadeSize = DEFAULT_FADE_SIZE,
	onScrollRef,
	style,
	...rest
}: ScrollFadeProps): JSX.Element {
	const [el, setEl] = useState<HTMLDivElement | null>(null);
	const [canScrollMore, setCanScrollMore] = useState(false);

	const setRef = useCallback(
		(node: HTMLDivElement | null) => {
			setEl(node);
			onScrollRef?.(node);
		},
		[onScrollRef],
	);

	useEffect(() => {
		if (!el) {
			setCanScrollMore(false);
			return;
		}

		const sync = () => {
			const more = el.scrollHeight - el.scrollTop - el.clientHeight > 1;
			setCanScrollMore((prev) => (prev === more ? prev : more));
		};

		// 与 QuickScrollOverlay 同款合帧：高频 DOM 变动下每帧至多一次布局读取。
		let frame: number | null = null;
		const scheduleSync = () => {
			if (frame !== null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				sync();
			});
		};

		sync();
		el.addEventListener("scroll", scheduleSync, { passive: true });

		const ro = new ResizeObserver(scheduleSync);
		const observeChildren = () => {
			ro.disconnect();
			ro.observe(el);
			for (const child of el.children) {
				ro.observe(child);
			}
		};
		observeChildren();

		// 深层变动由子节点 ResizeObserver 覆盖，childList 只为重建子节点观察列表。
		const mo = new MutationObserver(() => {
			observeChildren();
			scheduleSync();
		});
		mo.observe(el, { childList: true });

		return () => {
			if (frame !== null) cancelAnimationFrame(frame);
			el.removeEventListener("scroll", scheduleSync);
			ro.disconnect();
			mo.disconnect();
		};
	}, [el]);

	const maskImage = canScrollMore
		? `linear-gradient(to bottom, black 0%, black calc(100% - ${fadeSize}px), transparent 100%)`
		: undefined;

	const mergedStyle: CSSProperties = {
		...style,
		...(maskImage
			? {
					WebkitMaskImage: maskImage,
					maskImage,
				}
			: undefined),
	};

	return (
		<div ref={setRef} className={className} style={mergedStyle} {...rest}>
			{children}
		</div>
	);
}
