import { cn } from "@vetta/ui";
import { memo, useSyncExternalStore, type CSSProperties, type JSX } from "react";

/** 与行首图标同宽（h-3.5 w-3.5），色点再多也不推挤标题，列表文字保持左对齐。 */
const BOX_SIZE = 14;
/** 叠加态点径：三个点按 (BOX_SIZE - STACK_DOT) / 2 的步长正好铺满整盒。 */
const STACK_DOT_SIZE = 8;
/** 2×2 态点径：6 + 2 间隙 + 6 = 14。 */
const GRID_DOT_SIZE = 6;
const GRID_SLOTS = [
	{ left: 0, top: 0 },
	{ left: BOX_SIZE - GRID_DOT_SIZE, top: 0 },
	{ left: 0, top: BOX_SIZE - GRID_DOT_SIZE },
	{ left: BOX_SIZE - GRID_DOT_SIZE, top: BOX_SIZE - GRID_DOT_SIZE },
] as const;
const GRID_CAPACITY = GRID_SLOTS.length;
const CYCLE_INTERVAL_MS = 1600;

/**
 * 超出 4 个标签时，第四格轮播剩余颜色。
 *
 * 节拍器做成模块级共享：每行各起一个 timer 会让相邻行的轮播互相错开，
 * 看着像渲染坏了；这里所有轮播点共用一个心跳，同进同出。
 */
const cycleListeners = new Set<() => void>();
let cycleTick = 0;
let cycleTimer: ReturnType<typeof setInterval> | null = null;

function subscribeCycle(listener: () => void): () => void {
	cycleListeners.add(listener);
	if (cycleTimer === null) {
		cycleTimer = setInterval(() => {
			cycleTick += 1;
			for (const notify of [...cycleListeners]) notify();
		}, CYCLE_INTERVAL_MS);
	}
	return () => {
		cycleListeners.delete(listener);
		if (cycleListeners.size === 0 && cycleTimer !== null) {
			clearInterval(cycleTimer);
			cycleTimer = null;
		}
	};
}

function readCycleTick(): number {
	return cycleTick;
}

function dotStyle(color: string, size: number, left: number, top: number): CSSProperties {
	return { backgroundColor: color, height: size, width: size, left, top };
}

function CyclingDot({ colors }: { colors: readonly string[] }): JSX.Element {
	const tick = useSyncExternalStore(subscribeCycle, readCycleTick, readCycleTick);
	const slot = GRID_SLOTS[GRID_CAPACITY - 1];
	const color = colors[tick % colors.length] ?? colors[0] ?? "";
	return (
		<span
			data-tag-dot-cycling="true"
			className="absolute rounded-full transition-colors duration-500"
			style={dotStyle(color, GRID_DOT_SIZE, slot.left, slot.top)}
		/>
	);
}

export interface ConversationTagDotsViewProps {
	/** 会话身上的标签色，按标签创建顺序；空数组不渲染。 */
	readonly colors: readonly string[];
	readonly className?: string;
}

/**
 * 会话行首的标签色点组：1 个画单点，2–3 个叠加，4 个及以上排成 2×2，
 * 第四格在超过 4 个时轮播剩余颜色——盒子固定 14×14，永远不改变标题的起始位置。
 */
export const ConversationTagDotsView = memo(function ConversationTagDotsView({
	colors,
	className,
}: ConversationTagDotsViewProps): JSX.Element | null {
	if (colors.length === 0) return null;
	const grid = colors.length >= GRID_CAPACITY;
	return (
		<span
			aria-hidden="true"
			data-session-tag-dots={colors.length}
			className={cn("relative block h-3.5 w-3.5 shrink-0", className)}
		>
			{grid
				? GRID_SLOTS.slice(0, GRID_CAPACITY - 1).map((slot, index) => (
						<span
							key={`${colors[index]}-${index}`}
							className="absolute rounded-full"
							style={dotStyle(colors[index] ?? "", GRID_DOT_SIZE, slot.left, slot.top)}
						/>
					))
				: colors.map((color, index) => {
						const step = colors.length > 1 ? (BOX_SIZE - STACK_DOT_SIZE) / (colors.length - 1) : 0;
						const left = colors.length > 1 ? index * step : (BOX_SIZE - STACK_DOT_SIZE) / 2;
						return (
							<span
								key={`${color}-${index}`}
								// ring 用行底色描边：叠加时相邻同色标签才分得开。
								className="absolute rounded-full ring-1 ring-background"
								style={{
									...dotStyle(color, STACK_DOT_SIZE, left, (BOX_SIZE - STACK_DOT_SIZE) / 2),
									// 先创建的标签压在上层，顺序稳定不随数量跳动。
									zIndex: colors.length - index,
								}}
							/>
						);
					})}
			{grid ? (
				colors.length > GRID_CAPACITY ? (
					<CyclingDot colors={colors.slice(GRID_CAPACITY - 1)} />
				) : (
					<span
						className="absolute rounded-full"
						style={dotStyle(
							colors[GRID_CAPACITY - 1] ?? "",
							GRID_DOT_SIZE,
							GRID_SLOTS[GRID_CAPACITY - 1].left,
							GRID_SLOTS[GRID_CAPACITY - 1].top,
						)}
					/>
				)
			) : null}
		</span>
	);
});
