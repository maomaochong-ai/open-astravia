import { useTranslation } from "@astravia-org/plugin-sdk";
import { memo, useState } from "react";
import { refreshDesignCatalog, useCatalogState, type DesignSystem } from "../design-systems/index";
import { getPluginCtx } from "../plugin-context";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { SectionHeader } from "./SectionHeader";

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

function StyleCard({
	system,
	busy,
	onPick,
}: {
	system: DesignSystem;
	busy: boolean;
	onPick: (system: DesignSystem) => void;
}) {
	const { t } = useTranslation();
	/** 悬停中的条目：只让它自己的 demo 滚动，其余保持静止（状态收在卡片里，
	 *  悬停不再重渲染整张 82 卡的宫格）。 */
	const [hovered, setHovered] = useState(false);
	return (
		<button
			type="button"
			disabled={busy}
			onClick={() => onPick(system)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setHovered(true)}
			onBlur={() => setHovered(false)}
			aria-label={t("gallery.styles.view", { name: system.name })}
			className="flex aspect-[4/3] min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card p-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg disabled:opacity-40"
		>
			<DesignSystemTileContent system={system} demoActive={hovered} />
		</button>
	);
}

/** memo：卡片只依赖 system 引用与 busy，避免宫格重渲染时 82 张卡全量重跑。 */
const MemoizedStyleCard = memo(StyleCard);

export function DesignSystemGrid({ divided = false, busy, onPick }: DesignSystemGridProps) {
	const { t } = useTranslation();
	const { systems, status } = useCatalogState();
	return (
		<section className={divided ? "mt-8 border-t border-border/60 pt-6" : ""}>
			<SectionHeader title={t("gallery.styles.title")} hint={t("gallery.styles.hint")} />

			{systems.length > 0 ? (
				<div className={GRID_CLASS}>
					{systems.map((system) => (
						<MemoizedStyleCard key={system.id} system={system} busy={busy} onPick={onPick} />
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
