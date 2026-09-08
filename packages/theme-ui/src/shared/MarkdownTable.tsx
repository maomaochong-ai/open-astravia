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
import { readTableCells, toCsv, toMarkdown } from "./markdown-table-clipboard";

/**
 * Markdown 表格的统一渲染壳。chat 气泡与 activity 预览共用同一份实现。
 *
 * 布局要点（与旧实现的根本差异）：旧版是 `overflow-x-auto` 外壳套 `w-full` 的
 * table —— `w-full` 把表宽钉死在容器上，横向滚动永远不触发，浏览器只能靠压缩
 * 列宽塞下所有列，宽表因此被挤成竖排。这里改成 `w-max min-w-full`：表按内容
 * 自然宽度排布，容器负责裁剪与滚动。
 */

/** 会话流的布局根，breakout 以它的宽度为上界。 */
const BREAKOUT_ROOT_SELECTOR = "[data-message-feed-root]";
/** 宽视口下左侧导航 rail 浮在 top-1/2 left-3，给它留出安全边距。 */
const WIDE_GUTTER = 56;
const NARROW_GUTTER = 16;
/** 与 MessageFeedLayout 的 `@max-[52rem]:hidden` rail 断点一致。 */
const WIDE_BOUNDS = 832;

export interface MarkdownTableLabels {
	copyMarkdown: string;
	copyCsv: string;
	copied: string;
}

export interface MarkdownTableProps {
	children: ReactNode;
	/** 正文字号跟随宿主：chat 用 13px，activity 预览用 12px。 */
	fontSizeClass?: string;
	/** 不传则不渲染工具条（例如导出快照里没有可交互的复制按钮）。 */
	labels?: MarkdownTableLabels;
	/**
	 * 允许表格突破正文阅读栏、撑到会话视口宽度。只有能找到
	 * `[data-message-feed-root]` 祖先时才会生效，面板内的预览天然退化成纯滚动。
	 */
	allowBreakout?: boolean;
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

/**
 * 计算表格向两侧「探出」正文栏的像素数，以及当前是否还有内容可横向滚动。
 *
 * 单侧 overhang 而非直接改容器宽度：负 margin 不影响正文段落的排版基线，
 * 表格居中撑开，窄视口下自动退回 0。
 */
function useTableViewport(
	hostRef: React.RefObject<HTMLDivElement | null>,
	scrollRef: React.RefObject<HTMLDivElement | null>,
	allowBreakout: boolean,
): { overhang: number; overflow: OverflowState } {
	const [overhang, setOverhang] = useState(0);
	const [overflow, setOverflow] = useState<OverflowState>(NO_OVERFLOW);

	const measure = useCallback(() => {
		const host = hostRef.current;
		const scroll = scrollRef.current;
		if (!host || !scroll) return;

		const bounds = allowBreakout
			? (host.closest(BREAKOUT_ROOT_SELECTOR) as HTMLElement | null)
			: null;
		if (bounds) {
			const hostWidth = host.clientWidth;
			const boundsWidth = bounds.clientWidth;
			const gutter = boundsWidth >= WIDE_BOUNDS ? WIDE_GUTTER : NARROW_GUTTER;
			// 表格宽度只在 [正文栏宽, 视口宽 - 两侧安全边距] 之间取值。
			const maxWidth = Math.max(hostWidth, boundsWidth - gutter * 2);
			const desired = Math.min(scroll.scrollWidth, maxWidth);
			const next = Math.max(0, Math.round((desired - hostWidth) / 2));
			setOverhang((previous) => (Math.abs(previous - next) <= 1 ? previous : next));
		} else {
			setOverhang(0);
		}

		const maxScroll = scroll.scrollWidth - scroll.clientWidth;
		const left = scroll.scrollLeft > 1;
		const right = maxScroll - scroll.scrollLeft > 1;
		setOverflow((previous) =>
			previous.left === left && previous.right === right ? previous : { left, right },
		);
	}, [allowBreakout, hostRef, scrollRef]);

	const schedule = useFrameScheduler(measure);

	useEffect(() => {
		const host = hostRef.current;
		const scroll = scrollRef.current;
		if (!host || !scroll) return;

		schedule();
		const resizeObserver = new ResizeObserver(schedule);
		resizeObserver.observe(host);
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
	}, [hostRef, scrollRef, schedule]);

	return { overhang, overflow };
}

const TOOLBAR_BUTTON_CLASS =
	"inline-flex h-6 items-center gap-1 rounded-full bg-background/70 px-2 text-[11px] font-medium text-muted-foreground/70 backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground";

function TableToolbar({
	labels,
	getTable,
}: {
	labels: MarkdownTableLabels;
	getTable: () => HTMLTableElement | null;
}): JSX.Element {
	const [copied, setCopied] = useState<"markdown" | "csv" | null>(null);
	const timerRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		};
	}, []);

	const copy = useCallback(
		(kind: "markdown" | "csv") => {
			const table = getTable();
			if (!table) return;
			const rows = readTableCells(table);
			const text = kind === "markdown" ? toMarkdown(rows) : toCsv(rows);
			void navigator.clipboard.writeText(text).then(() => {
				setCopied(kind);
				if (timerRef.current !== null) window.clearTimeout(timerRef.current);
				timerRef.current = window.setTimeout(() => setCopied(null), 1500);
			});
		},
		[getTable],
	);

	return (
		<div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover/table:pointer-events-auto group-hover/table:opacity-100">
			<button
				type="button"
				className={TOOLBAR_BUTTON_CLASS}
				title={labels.copyMarkdown}
				onClick={() => copy("markdown")}
			>
				<span
					className={cn(
						copied === "markdown" ? "icon-[mdi--check]" : "icon-[mdi--language-markdown-outline]",
						"h-3.5 w-3.5",
					)}
				/>
				{copied === "markdown" ? labels.copied : "MD"}
			</button>
			<button
				type="button"
				className={TOOLBAR_BUTTON_CLASS}
				title={labels.copyCsv}
				onClick={() => copy("csv")}
			>
				<span
					className={cn(
						copied === "csv" ? "icon-[mdi--check]" : "icon-[mdi--table-arrow-right]",
						"h-3.5 w-3.5",
					)}
				/>
				{copied === "csv" ? labels.copied : "CSV"}
			</button>
		</div>
	);
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
	labels,
	allowBreakout = true,
}: MarkdownTableProps): JSX.Element {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const { overhang, overflow } = useTableViewport(hostRef, scrollRef, allowBreakout);
	const getTable = useCallback(
		() => scrollRef.current?.querySelector("table") ?? null,
		[],
	);

	const frameStyle: CSSProperties =
		overhang > 0 ? { marginLeft: -overhang, marginRight: -overhang } : {};

	return (
		<div ref={hostRef} className="my-3">
			<div
				className="group/table md-table-shadow-host relative"
				style={frameStyle}
				data-md-table-frame=""
			>
				{labels ? <TableToolbar labels={labels} getTable={getTable} /> : null}
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
