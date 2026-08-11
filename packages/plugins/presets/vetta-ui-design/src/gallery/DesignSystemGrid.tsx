import { useTranslation } from "@vetta-org/plugin-sdk";
import { useState } from "react";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { refreshDesignCatalog, useCatalogState } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";
import { getPluginCtx } from "../plugin-context";

/**
 * 侧边栏「设计」页的风格库：和项目卡片同一套宫格语言，作为页面内容的一部分往下滚。
 *
 * 位置由调用方决定——画廊空着时它排在引导语下面当首屏主角，已经有设计时排在项目宫格
 * 之后、用一条分隔线隔开。
 *
 * 内容全部来自远端资源仓库，所以「一套都没有」是真实状态：还在拉时给骨架，拉不到时
 * 给解释和重试，绝不留一块没有说明的空白。
 */
export interface DesignSystemGridProps {
	/** 上方还有别的内容时画一条分隔线，避免和项目宫格糊成一片。 */
	divided?: boolean;
	busy: boolean;
	/** 点了一张风格卡。调用方决定后续（当前是打开详情 Dialog）。 */
	onPick: (system: DesignSystem) => void;
}

/** 固定三列：预览是缩小的整页网页，卡片给得大一些才看得出风格。 */
const GRID_CLASS = "grid grid-cols-3 gap-4";
/** 骨架格数：填满一两行即可，不必假装有多少套。 */
const SKELETON_COUNT = 6;

export function DesignSystemGrid({ divided = false, busy, onPick }: DesignSystemGridProps) {
	const { t } = useTranslation();
	const { systems, status } = useCatalogState();
	/** 悬停中的条目：只让它的 demo 滚动，其余保持静止。 */
	const [hovered, setHovered] = useState<string | null>(null);

	return (
		<section className={divided ? "mt-6 border-t border-border pt-5" : ""}>
			<header className="mb-3 flex min-w-0 items-baseline gap-2">
				<h2 className="shrink-0 text-sm font-medium text-foreground">{t("gallery.styles.title")}</h2>
				<p className="min-w-0 truncate text-[11px] text-muted-foreground">{t("gallery.styles.hint")}</p>
			</header>

			{systems.length > 0 ? (
				<div className={GRID_CLASS}>
					{systems.map((system) => (
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
							<DesignSystemTileContent system={system} demoActive={hovered === system.id} />
						</button>
					))}
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
			)}
		</section>
	);
}
