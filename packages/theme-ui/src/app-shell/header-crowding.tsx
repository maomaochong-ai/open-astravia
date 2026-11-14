import {
	type JSX,
	type ReactNode,
	type RefObject,
	createContext,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

/**
 * 左右按钮组之间至少要留出的空隙。页头行本身有 8px 的 flex gap，
 * 小于这个值就说明两边的按钮要贴上了。标题可以先被截断，不占这份宽度。
 */
export const HEADER_CROWD_ENTER_GAP = 12;

/**
 * 恢复展开后至少要留出这么多空隙才重新摊开。
 * 比进入阈值宽一截，避免宽度在临界点上来回闪。
 */
export const HEADER_CROWD_EXIT_GAP = 28;

const HeaderCrowdingContext = createContext(false);

/** 页头测到左右按钮组挤在一起。不在页头里时（测试、自定义主题）为 false。 */
export function useHeaderCrowded(): boolean {
	return useContext(HeaderCrowdingContext);
}

export function HeaderCrowdingProvider({
	crowded,
	children,
}: {
	readonly crowded: boolean;
	readonly children: ReactNode;
}): JSX.Element {
	return <HeaderCrowdingContext.Provider value={crowded}>{children}</HeaderCrowdingContext.Provider>;
}

export interface HeaderCrowdingMeasurement {
	readonly crowded: boolean;
	readonly containerWidth: number;
	/** 左侧不会被截断的部分（侧边栏、新会话），不含标题。 */
	readonly leftChromeWidth: number;
	readonly currentRightWidth: number;
	/** 上一次展开时右侧的宽度。挤窄之后右侧变短，不能拿变短后的宽度来决定要不要展开。 */
	readonly expandedRightWidth: number;
}

/**
 * 只在左侧固定按钮和右侧按钮组放不下时收起。
 * 标题在中间，宽了会被截断，不能因为它把空隙占满就把按钮收进菜单。
 */
export function nextHeaderCrowded(input: HeaderCrowdingMeasurement): {
	readonly crowded: boolean;
	readonly expandedRightWidth: number;
} {
	if (input.containerWidth <= 0 || input.currentRightWidth <= 0) {
		return { crowded: input.crowded, expandedRightWidth: input.expandedRightWidth };
	}
	const fits = (rightWidth: number, gap: number): boolean =>
		input.leftChromeWidth + rightWidth + gap <= input.containerWidth;
	if (!input.crowded) {
		return {
			crowded: !fits(input.currentRightWidth, HEADER_CROWD_ENTER_GAP),
			expandedRightWidth: input.currentRightWidth,
		};
	}
	return {
		crowded: !fits(input.expandedRightWidth, HEADER_CROWD_EXIT_GAP),
		expandedRightWidth: input.expandedRightWidth,
	};
}

/** 左侧标题会伸缩，只有 `flex-shrink: 0` 的按钮才算会和右侧打架的宽度。 */
export function leftHeaderChromeWidth(left: HTMLElement): number {
	let width = 0;
	for (const node of left.children) {
		if (!(node instanceof HTMLElement)) continue;
		const style = getComputedStyle(node);
		if (style.flexShrink !== "0") continue;
		width += node.offsetWidth + (Number.parseFloat(style.marginLeft) || 0) + (Number.parseFloat(style.marginRight) || 0);
	}
	return width;
}

/**
 * 盯着页头：会话列窄到左侧按钮和右侧按钮组放不下时，才把右侧收进「更多」。
 * 标题再长也先截断，宽屏两边没碰上就保持原来的一排按钮。
 * 测量放在布局提交后，挤窄的状态在绘制前就定下来，不会闪一帧重叠。
 */
export function useHeaderCrowding(): {
	readonly crowded: boolean;
	readonly leftRef: RefObject<HTMLDivElement | null>;
	readonly rightRef: RefObject<HTMLDivElement | null>;
} {
	const leftRef = useRef<HTMLDivElement>(null);
	const rightRef = useRef<HTMLDivElement>(null);
	const [crowded, setCrowded] = useState(false);
	const crowdedRef = useRef(false);
	const expandedRightWidth = useRef(0);

	useLayoutEffect(() => {
		const left = leftRef.current;
		const right = rightRef.current;
		if (!left || !right) return;

		const measure = (): void => {
			const leftEl = leftRef.current;
			const rightEl = rightRef.current;
			const container = leftEl?.parentElement;
			if (!leftEl || !rightEl || !container) return;
			const next = nextHeaderCrowded({
				crowded: crowdedRef.current,
				containerWidth: container.clientWidth,
				leftChromeWidth: leftHeaderChromeWidth(leftEl),
				currentRightWidth: rightEl.offsetWidth,
				expandedRightWidth: expandedRightWidth.current,
			});
			expandedRightWidth.current = next.expandedRightWidth;
			if (next.crowded === crowdedRef.current) return;
			crowdedRef.current = next.crowded;
			setCrowded(next.crowded);
		};

		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(left);
		observer.observe(right);
		if (left.parentElement) observer.observe(left.parentElement);
		return () => observer.disconnect();
	}, []);

	return { crowded, leftRef, rightRef };
}
