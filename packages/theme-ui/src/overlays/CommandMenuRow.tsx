import { motion } from "motion/react";
import type { JSX } from "react";
import { cn } from "@vetta/ui";
import type { CommandMenuHighlightRange, CommandMenuItemView } from "./command-menu-types";

/**
 * 结果行。选中态由**静态 CSS 背景**表达，只有 2px 的左侧指示条参与 layout 动画
 * ——对齐 `chat/AtPanelView` 的既有做法：整行背景每次都做布局动画在低端机上代价过高。
 */

/** 把命中区间渲染成高亮片段；区间由调用方保证已排序且互不重叠。 */
function Highlighted({
	text,
	ranges,
}: {
	text: string;
	ranges: readonly CommandMenuHighlightRange[];
}): JSX.Element {
	if (ranges.length === 0) return <>{text}</>;
	const nodes: JSX.Element[] = [];
	let cursor = 0;
	for (const [index, range] of ranges.entries()) {
		if (range.start > cursor) {
			nodes.push(<span key={`plain-${index}`}>{text.slice(cursor, range.start)}</span>);
		}
		nodes.push(
			<span key={`hit-${index}`} className="text-primary">
				{text.slice(range.start, range.end)}
			</span>,
		);
		cursor = range.end;
	}
	if (cursor < text.length) nodes.push(<span key="plain-tail">{text.slice(cursor)}</span>);
	return <>{nodes}</>;
}

export interface CommandMenuRowProps {
	readonly item: CommandMenuItemView;
	readonly active: boolean;
	/** 结果集刚变化时抑制指示条的位移动画，避免逐击键抖动。 */
	readonly suppressSelectionAnimation: boolean;
	readonly onActivate: (id: string) => void;
	readonly onHover: (id: string) => void;
	readonly registerRef: (id: string, element: HTMLButtonElement | null) => void;
}

export function CommandMenuRow({
	item,
	active,
	suppressSelectionAnimation,
	onActivate,
	onHover,
	registerRef,
}: CommandMenuRowProps): JSX.Element {
	const disabled = Boolean(item.disabled);
	return (
		<button
			type="button"
			ref={(element) => registerRef(item.id, element)}
			role="option"
			id={`command-menu-item-${item.id}`}
			aria-selected={active}
			aria-disabled={disabled || undefined}
			title={disabled ? item.disabledReason : undefined}
			disabled={disabled}
			onMouseMove={() => {
				if (!disabled) onHover(item.id);
			}}
			onClick={() => {
				if (!disabled) onActivate(item.id);
			}}
			className={cn(
				"relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors",
				disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
			)}
			style={{
				background: active ? "color-mix(in srgb, var(--primary) 9%, transparent)" : "transparent",
			}}
		>
			{active && (
				<motion.span
					layoutId="command-menu-active-marker"
					// 结果重算时 layout 动画会把指示条从旧行“弹”到新行，逐击键播放既抖又费；
					// 只有用户主动上下移动选中项时才让它滑动。
					layout={!suppressSelectionAnimation}
					transition={
						suppressSelectionAnimation
							? { duration: 0 }
							: { type: "spring", stiffness: 500, damping: 32 }
					}
					className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
				/>
			)}
			<span
				aria-hidden="true"
				className={cn(item.icon, "size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")}
			/>
			<span className="flex min-w-0 flex-1 items-baseline gap-2">
				<span className="truncate text-[13px] text-foreground">
					<Highlighted text={item.title} ranges={item.titleHighlights} />
				</span>
				{item.subtitle && (
					<span className="truncate text-[11px] text-muted-foreground">
						<Highlighted text={item.subtitle} ranges={item.subtitleHighlights ?? []} />
					</span>
				)}
			</span>
			{item.badge && (
				<span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
					{item.badge}
				</span>
			)}
		</button>
	);
}
