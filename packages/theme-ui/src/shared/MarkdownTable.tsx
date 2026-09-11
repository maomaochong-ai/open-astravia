import {
	type CSSProperties,
	type JSX,
	type ReactNode,
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

/**
 * Markdown 表格的统一渲染壳。chat 气泡与 activity 预览共用同一份实现。
 *
 * 布局要点（与旧实现的根本差异）：旧版是 `overflow-x-auto` 外壳套 `w-full` 的
 * table —— `w-full` 把表宽钉死在容器上，横向滚动永远不触发，浏览器只能靠压缩
 * 列宽塞下所有列，宽表因此被挤成竖排。这里改成 `w-max min-w-full`：表按内容
 * 自然宽度排布，容器宽度始终等于正文栏（与文字左右对齐），超出部分横向滚动。
 */

export interface MarkdownTableProps {
	children: ReactNode;
	/** 正文字号跟随宿主：chat 用 13px，activity 预览用 12px。 */
	fontSizeClass?: string;
}

interface OverflowState {
	readonly left: boolean;
	readonly right: boolean;
}

const NO_OVERFLOW: OverflowState = { left: false, right: false };

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

/** 逐帧合并的测量调度：流式追加行时每帧至多做一次布局读取。 */
function useFrameScheduler(run: () => void): () => void {
	const runRef = useRef(run);
	runRef.current = run;
	const frameRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		};
	}, []);

	return useCallback(() => {
		if (frameRef.current !== null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			runRef.current();
		});
	}, []);
}

/** 观察横向滚动位置，用于两侧的可滚动阴影提示。 */
function useOverflowState(scrollRef: React.RefObject<HTMLDivElement | null>): OverflowState {
	const [overflow, setOverflow] = useState<OverflowState>(NO_OVERFLOW);

	const measure = useCallback(() => {
		const scroll = scrollRef.current;
		if (!scroll) return;
		const maxScroll = scroll.scrollWidth - scroll.clientWidth;
		const left = scroll.scrollLeft > 1;
		const right = maxScroll - scroll.scrollLeft > 1;
		setOverflow((previous) =>
			previous.left === left && previous.right === right ? previous : { left, right },
		);
	}, [scrollRef]);

	const schedule = useFrameScheduler(measure);

	useEffect(() => {
		const scroll = scrollRef.current;
		if (!scroll) return;

		schedule();
		const resizeObserver = new ResizeObserver(schedule);
		resizeObserver.observe(scroll);
		// 流式追加行会换掉 table 子树，尺寸变化不经过 ResizeObserver，靠 DOM 变更兜底。
		const mutationObserver = new MutationObserver(schedule);
		mutationObserver.observe(scroll, { childList: true, subtree: true, characterData: true });
		scroll.addEventListener("scroll", schedule, { passive: true });

		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			scroll.removeEventListener("scroll", schedule);
		};
	}, [scrollRef, schedule]);

	return overflow;
}

/**
 * 横向可滚动的阴影提示。用 inset box-shadow 而不是 mask 渐隐：
 * 表格有斑马纹与边框，mask 会把边框一起淡掉，看着像渲染缺陷。
 */
function overflowShadow(overflow: OverflowState): string | undefined {
	const shadows: string[] = [];
	if (overflow.left) shadows.push("inset 10px 0 8px -10px var(--md-table-shadow)");
	if (overflow.right) shadows.push("inset -10px 0 8px -10px var(--md-table-shadow)");
	return shadows.length > 0 ? shadows.join(", ") : undefined;
}

export const MarkdownTable = memo(function MarkdownTable({
	children,
	fontSizeClass = "text-[13px]",
}: MarkdownTableProps): JSX.Element {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const overflow = useOverflowState(scrollRef);

	return (
		<div className="my-3">
			<div className="md-table-shadow-host relative" data-md-table-frame="">
				<div
					ref={scrollRef}
					className="max-h-[70vh] overflow-auto overscroll-x-contain rounded-xl border border-border/60 bg-muted p-[3px]"
					style={{ boxShadow: overflowShadow(overflow) }}
				>
					<table
						className={cn(
							"md-table w-max min-w-full text-left",
							// border-separate 是硬要求：collapse 模式下单元格的 border-radius 不生效，
							// 而 tbody 的「浅色面板」圆角只能画在首行的首尾单元格上。
							"border-separate border-spacing-0",
							// tbody 面板：每个 td 自己铺底色，首行两角收圆，底部两角由容器的
							// overflow + rounded-xl 裁掉。
							"[&_tbody_tr:first-child>td]:border-t-0",
							"[&_tbody_tr:first-child>td:first-child]:rounded-tl-[9px]",
							"[&_tbody_tr:first-child>td:last-child]:rounded-tr-[9px]",
							"[&_tbody_tr:last-child>td:first-child]:rounded-bl-[9px]",
							"[&_tbody_tr:last-child>td:last-child]:rounded-br-[9px]",
							// hover 提亮要压过 td 自己的底色，所以规则挂在表级选择器上。
							"[&_tbody_tr:hover>td]:bg-accent",
							fontSizeClass,
						)}
					>
						{children}
					</table>
				</div>
			</div>
		</div>
	);
});

export function MarkdownTableHead({ children }: { children: ReactNode }): JSX.Element {
	return <thead>{children}</thead>;
}

export function MarkdownTableBody({ children }: { children: ReactNode }): JSX.Element {
	return <tbody>{children}</tbody>;
}

/**
 * 行只作结构：border-separate 下 tr 的背景会被 td 自己的底色盖住，
 * 因此底色、分隔线与 hover 全部由单元格承担（见 MarkdownTable 的表级规则）。
 */
export function MarkdownTableRow({ children }: { children: ReactNode }): JSX.Element {
	return <tr className="group/row">{children}</tr>;
}

/**
 * 单元格排版：
 * - `max-w-[34ch]`：短单元格取自然宽度不折行，只有长文本到 34ch 才换行。
 * - `word-break/overflow-wrap: normal`：抵消 `.markdown-body break-words` 的逐字断行，
 *   否则「业务大区 / 单元」会被拆成一列竖排汉字。
 * - `style` 必须透传：remark-gfm 把 `|---:|` 的对齐信息放在这里，丢了数字列就没法右对齐。
 */
const CELL_CLASS =
	"max-w-[34ch] px-4 py-2.5 align-middle first:pl-5 last:pr-5 [overflow-wrap:normal] [word-break:normal] [text-wrap:pretty]";

export function MarkdownTableHeaderCell({
	children,
	style,
}: {
	children: ReactNode;
	style?: CSSProperties;
}): JSX.Element {
	return (
		<th
			style={style}
			className={cn(
				CELL_CLASS,
				// -top-[3px] 抵消容器的 3px 内边距：表头吸顶时要贴住外框上边缘，
				// 否则滚动内容会从它上方那条缝里穿过去。
				"sticky -top-[3px] z-[1] whitespace-nowrap bg-muted py-2.5 text-[12px] font-medium text-muted-foreground/80",
			)}
		>
			{children}
		</th>
	);
}

export function MarkdownTableCell({
	children,
	style,
}: {
	children: ReactNode;
	style?: CSSProperties;
}): JSX.Element {
	return (
		<td
			style={style}
			className={cn(
				CELL_CLASS,
				"border-t border-border bg-background text-foreground transition-colors",
			)}
		>
			{children}
		</td>
	);
}
