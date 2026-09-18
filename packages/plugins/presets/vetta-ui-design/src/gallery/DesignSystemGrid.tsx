import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { refreshDesignCatalog, useCatalogState } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";
import { STYLE_GRID_MAX_COLUMNS, styleGridMetricsFor, styleGridWindow } from "../new-session/style-grid-layout";
import { getPluginCtx } from "../plugin-context";
import { SectionHeader } from "./SectionHeader";

/**
 * 侧边栏「设计」页的风格库：和项目卡片同一套宫格语言，作为页面内容的一部分往下滚。
 *
 * 位置由调用方决定——画廊空着时它排在引导语下面当首屏主角，已经有设计时排在项目宫格
 * 之后、用一条分隔线隔开。
 *
 * 内容全部来自远端资源仓库，所以「一套都没有」是真实状态：还在拉时给骨架，拉不到时
 * 给解释和重试，绝不留一块没有说明的空白。
 *
 * 分区标题可由调用方先画（`hideHeader`），让可见完成不等风格墙 chunk。
 *
 * 静态只铺色板，悬停到哪张才挂 HTML demo：一张 demo 是一个 iframe + 一份完整文档，
 * 画廊保活后若全量挂上，切走仍会把解析和内存压在后续页面上。
 *
 * 按行窗口化与新会话页风格库同一套几何：几十张缩略图各带一套 mini 布局，Activity
 * 切回若整墙 commit，主线程会再吃掉一次 ~100ms 长任务。
 */
export interface DesignSystemGridProps {
	/** 上方还有别的内容时画一条分隔线，避免和项目宫格糊成一片。 */
	divided?: boolean;
	/** 调用方已画出分区标题时省略，避免风格墙 chunk 到达后叠两个标题。 */
	hideHeader?: boolean;
	busy: boolean;
	/** 点了一张风格卡。调用方决定后续（当前是打开详情 Dialog）。 */
	onPick: (system: DesignSystem) => void;
}

/** 固定三列：预览是缩小的整页网页，卡片给得大一些才看得出风格。与 `gap-4` 一致。 */
const GRID_CLASS = "grid grid-cols-3 gap-4";
const GALLERY_STYLE_GAP = 16;
/** 尚未量到宽度时按常见主栏估算，避免第一帧把几十张缩略图画满。 */
const FALLBACK_GRID_WIDTH = 960;
/** 骨架格数：填满一两行即可，不必假装有多少套。 */
const SKELETON_COUNT = 6;

function galleryStyleMetrics(width: number) {
	return styleGridMetricsFor(width > 0 ? width : FALLBACK_GRID_WIDTH, STYLE_GRID_MAX_COLUMNS, GALLERY_STYLE_GAP);
}

export function DesignSystemGrid({ divided = false, hideHeader = false, busy, onPick }: DesignSystemGridProps) {
	const { t } = useTranslation();
	const { systems, status } = useCatalogState();
	/** 悬停中的条目：只让它的 demo 滚动，其余保持静止。 */
	const [hovered, setHovered] = useState<string | null>(null);
	const grid = useRef<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(0);
	const [range, setRange] = useState({ start: 0, end: STYLE_GRID_MAX_COLUMNS * 3 });
	const rangeRef = useRef(range);
	const frameRef = useRef(0);
	const metrics = useMemo(() => galleryStyleMetrics(width), [width]);

	useLayoutEffect(() => {
		const node = grid.current;
		if (!node) return;
		const measure = () => setWidth(node.clientWidth);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [systems.length]);

	const syncRange = useCallback(() => {
		const node = grid.current;
		if (!node || metrics.rowHeight <= 0) return;
		const next = styleGridWindow({
			scrolledPast: -node.getBoundingClientRect().top,
			viewportHeight: window.innerHeight,
			metrics,
			total: systems.length,
		});
		const current = rangeRef.current;
		if (next.start === current.start && next.end === current.end) return;
		rangeRef.current = next;
		setRange(next);
	}, [metrics, systems.length]);

	useEffect(() => {
		const onScroll = () => {
			if (frameRef.current) return;
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = 0;
				syncRange();
			});
		};
		syncRange();
		window.addEventListener("scroll", onScroll, { capture: true, passive: true });
		window.addEventListener("resize", onScroll, { passive: true });
		return () => {
			window.removeEventListener("scroll", onScroll, { capture: true });
			window.removeEventListener("resize", onScroll);
			if (frameRef.current) cancelAnimationFrame(frameRef.current);
			frameRef.current = 0;
		};
	}, [syncRange]);

	const { columns, rowHeight } = metrics;
	const rowCount = Math.ceil(systems.length / columns);
	const start = Math.min(range.start, Math.max(0, (rowCount - 1) * columns));
	const end = Math.max(range.end, start + columns);
	const leadingRows = Math.floor(start / columns);
	const trailingRows = Math.max(0, rowCount - Math.ceil(end / columns));

	const body =
		systems.length > 0 ? (
			<div
				ref={grid}
				style={{ paddingTop: leadingRows * rowHeight, paddingBottom: trailingRows * rowHeight }}
			>
				<div className={GRID_CLASS}>
					{systems.slice(start, end).map((system) => (
						<button
							key={system.id}
							type="button"
							disabled={busy}
							onClick={() => onPick(system)}
							onMouseEnter={() => setHovered(system.id)}
							onMouseLeave={() => setHovered((current) => (current === system.id ? null : current))}
							onFocus={() => setHovered(system.id)}
							onBlur={() => setHovered((current) => (current === system.id ? null : current))}
							aria-label={t("gallery.styles.view", { name: system.name })}
							className="flex aspect-[4/3] min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card p-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg disabled:opacity-40"
						>
							<DesignSystemTileContent
								system={system}
								demo={hovered === system.id}
								demoActive={hovered === system.id}
							/>
						</button>
					))}
				</div>
			</div>
		) : status === "loading" ? (
			<div className={GRID_CLASS} aria-busy="true" aria-label={t("gallery.styles.loading")}>
				{Array.from({ length: SKELETON_COUNT }, (_, index) => (
					<div
						key={`skeleton-${index}`}
						className="aspect-[4/3] animate-pulse rounded-xl border border-border bg-accent/40"
					/>
				))}
			</div>
		) : (
			<div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border px-4 py-5">
				<p className="text-xs text-foreground">{t("gallery.styles.offline.title")}</p>
				<p className="text-[11px] leading-relaxed text-muted-foreground">
					{t("gallery.styles.offline.description")}
				</p>
				<button
					type="button"
					onClick={() => void refreshDesignCatalog(getPluginCtx(), Date.now(), { force: true })}
					className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent"
				>
					{t("gallery.styles.retry")}
				</button>
			</div>
		);

	if (hideHeader) return body;

	return (
		<section className={divided ? "mt-8 border-t border-border/60 pt-6" : ""}>
			<SectionHeader title={t("gallery.styles.title")} hint={t("gallery.styles.hint")} />
			{body}
		</section>
	);
}
