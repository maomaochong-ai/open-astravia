import { ButtonGroup } from "@astravia-org/ui/button-group";
import { SessionTopItem, type SessionTopMenuItem } from "@astravia-org/ui/session-top-item";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * 会话页顶栏的一组动作：胶囊按钮组 + 窄窗收纳。
 *
 * 为什么需要：右上角的操作从最早的两个长到了五六个，窗口一窄就溢出或被裁掉，
 * 用户找不到操作。这里把「放得下几个」交给容器实测宽度决定，放不下的收进「更多」菜单，
 * 而不是按固定数量——图标按钮与带文字按钮的宽度不同，按数量算必然错。
 *
 * 度量方式与页签条一致：渲染一层不可见的副本量每个按钮的宽度，再按容器宽度累加。
 * 只依赖 ResizeObserver，不读全局状态。
 */
export interface HeaderActionItem {
	readonly id: string;
	/** tooltip 与可访问名。纯图标按钮必须给。 */
	readonly title: string;
	/** 图标类名，如 `icon-[solar--pin-linear]`。 */
	readonly icon: string;
	readonly active?: boolean;
	readonly disabled?: boolean;
	readonly onClick: () => void;
	/**
	 * 收纳优先级：数值越大越晚被收进「更多」。不传按 0 计。
	 *
	 * 用途是保护「用户此刻最可能点的那几个」：面板开关与导出比置顶、终端更常用，
	 * 窗口变窄时应当先收起后者。顺序仍按数组顺序渲染，priority 只决定谁先让位。
	 */
	readonly priority?: number;
}

export interface HeaderActionGroupLabels {
	/** 「更多」按钮的 tooltip / 可访问名。 */
	readonly more: string;
	/** 被收纳的动作在菜单里的额外标注（可选）。 */
	readonly moreSection?: string;
}

/** 单个图标按钮的宽度：`w-8` = 32px，与按钮组内部一致。 */
const ITEM_WIDTH = 32;
/** 「更多」按钮自身占的宽度，溢出时必须预留。 */
const MORE_WIDTH = 32;
/** 组的内边距（`p-0.5` 两侧合计 4px）。 */
const GROUP_PADDING = 4;

export interface HeaderActionGroupProps {
	readonly items: readonly HeaderActionItem[];
	readonly labels: HeaderActionGroupLabels;
	/** 可用宽度（像素）。不传则由容器实测。仅测试用。 */
	readonly availableWidth?: number;
}

/** 计算放得下几个动作：返回可见数量。 */
export function resolveVisibleCount(total: number, availableWidth: number, widths?: readonly number[]): number {
	if (total === 0) return 0;
	const usable = availableWidth - GROUP_PADDING;
	let used = 0;
	let visible = 0;
	for (let index = 0; index < total; index += 1) {
		const next = used + (widths?.[index] ?? ITEM_WIDTH);
		if (next > usable) break;
		used = next;
		visible += 1;
	}
	// 全部放得下：不预留「更多」的位置。
	if (visible === total) return total;
	// 放不下：从尾部收回一个，给「更多」按钮腾位置。
	while (visible > 0 && used + MORE_WIDTH > usable) {
		visible -= 1;
		used -= widths?.[visible] ?? ITEM_WIDTH;
	}
	return visible;
}

/**
 * 按收纳优先级排序：priority 大的排前面，相同则保持原顺序。
 * 结果用于「谁能留下」的判定，渲染顺序仍用调用方给的原顺序。
 */
export function orderByKeepPriority<T extends { readonly priority?: number }>(items: readonly T[]): T[] {
	return items
		.map((item, index) => ({ item, index }))
		.sort((left, right) => {
			const diff = (right.item.priority ?? 0) - (left.item.priority ?? 0);
			return diff !== 0 ? diff : left.index - right.index;
		})
		.map((entry) => entry.item);
}

export function HeaderActionGroup({ items, labels, availableWidth }: HeaderActionGroupProps): JSX.Element | null {
	const containerRef = useRef<HTMLDivElement>(null);
	const [measuredWidth, setMeasuredWidth] = useState(0);

	// 可用宽度来自父容器：本组件是 inline-flex，自身宽度会被内容撑开，量自己没有意义。
	useLayoutEffect(() => {
		const host = containerRef.current?.parentElement;
		if (!host) return;
		const measure = (): void => setMeasuredWidth(host.getBoundingClientRect().width);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(host);
		return () => observer.disconnect();
	}, []);

	// 兜底：父容器没有可用宽度（首次渲染或隐藏）时全部显示，宁可不收纳也不要凭空少了按钮。
	const width = availableWidth ?? measuredWidth;
	const visibleCount = width > 0 ? resolveVisibleCount(items.length, width) : items.length;
	// 先按「谁更该留下」决定名额，再按原始顺序渲染：被收起的总是优先级最低的那几个，
	// 而可见项在屏幕上的相对位置不会因为窗口变窄而重排。
	const keepSet = new Set(orderByKeepPriority(items).slice(0, visibleCount).map((item) => item.id));
	const visible = items.filter((item) => keepSet.has(item.id));
	const overflow = items.filter((item) => !keepSet.has(item.id));

	const menuItems: readonly SessionTopMenuItem[] = overflow.map((item) => ({
		id: item.id,
		label: item.title,
		icon: <span className={item.icon} aria-hidden="true" />,
		disabled: item.disabled,
		onSelect: item.onClick,
	}));

	const handleOverflowSelect = useCallback((item: HeaderActionItem) => {
		if (item.disabled) return;
		item.onClick();
	}, []);

	if (items.length === 0) return null;

	return (
		<div ref={containerRef} className="flex min-w-0 items-center">
			<ButtonGroup>
				{visible.map((item) => (
					<SessionTopItem
						key={item.id}
						icon={<span className={item.icon} aria-hidden="true" />}
						title={item.title}
						aria-label={item.title}
						active={item.active === true}
						disabled={item.disabled}
						onClick={() => handleOverflowSelect(item)}
					/>
				))}
				{overflow.length > 0 && (
					<SessionTopItem
						icon={<span className="icon-[solar--menu-dots-linear]" aria-hidden="true" />}
						title={labels.more}
						aria-label={labels.more}
						menuItems={menuItems}
					/>
				)}
			</ButtonGroup>
		</div>
	);
}
