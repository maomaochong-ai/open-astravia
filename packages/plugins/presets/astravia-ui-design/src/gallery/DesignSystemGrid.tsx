import { useTranslation } from "@astravia-org/plugin-sdk";
import { useStyleWallWindow } from "../cards/use-style-wall-window";
import { refreshDesignCatalog, useCatalogState } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";
import { getPluginCtx } from "../plugin-context";
import { GallerySystemCard } from "./GallerySystemCard";
import { SectionHeader } from "./SectionHeader";

/**
 * 侧边栏「设计」页的风格库：与项目卡同一套卡片语言（16:10 预览 + 两行信息、同尺寸同网格），
 * 作为页面内容的一部分往下滚。
 *
 * 内容全部来自远端资源仓库，所以「一套都没有」是真实状态：还在拉时给骨架，拉不到时
 * 给解释和重试，绝不留一块没有说明的空白。
 *
 * 远端目录现在有八十多套，整份铺开就是八十多段骨架动画。所以和会话页的风格库共用同一套
 * 按行窗口化（`use-style-wall-window`）；预览是纯 token 骨架（无 iframe），没有额外挂载成本。
 */
export interface DesignSystemGridProps {
	/** 上方还有别的内容时画一条分隔线，避免和项目宫格糊成一片。 */
	divided?: boolean;
	busy: boolean;
	/** 点了一张风格卡。调用方决定后续（当前是打开详情 Dialog）。 */
	onPick: (system: DesignSystem) => void;
}

/** 宫格本身：`gap-4` 与行高换算共用同一个 16px，列数固定三列。 */
const GRID_CLASS = "grid gap-4";
const GRID_GAP = 16;
const GRID_COLUMNS = 3;
/** 骨架格数：填满一两行即可，不必假装有多少套。 */
const SKELETON_COUNT = 6;

export function DesignSystemGrid({ divided = false, busy, onPick }: DesignSystemGridProps) {
	const { t } = useTranslation();
	const { systems, status } = useCatalogState();
	// 固定三列的版式，卡片随面板变窄是既定视觉，所以不按最小卡宽降列。
	const wall = useStyleWallWindow({ total: systems.length, gap: GRID_GAP, maxColumns: GRID_COLUMNS, minCardWidth: 0 });

	return (
		<section className={divided ? "mt-8" : ""}>
			<SectionHeader title={t("gallery.styles.title")} />

			{systems.length > 0 ? (
				<div
					ref={wall.ref}
					className={GRID_CLASS}
					style={{
						gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
						paddingTop: wall.paddingTop,
						paddingBottom: wall.paddingBottom,
					}}
				>
					{systems.slice(wall.start, wall.end).map((system) => (
						<GallerySystemCard key={system.id} system={system} disabled={busy} onPick={onPick} />
					))}
				</div>
			) : status === "loading" ? (
				<div className={GRID_CLASS} aria-busy="true" aria-label={t("gallery.styles.loading")}>
					{Array.from({ length: SKELETON_COUNT }, (_, index) => (
						<div
							key={`skeleton-${index}`}
							className="aspect-[16/10] animate-pulse rounded-xl border border-border bg-accent/40"
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
			)}
		</section>
	);
}
