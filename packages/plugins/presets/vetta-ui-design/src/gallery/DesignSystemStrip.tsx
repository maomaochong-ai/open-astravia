import { useTranslation } from "@vetta-org/plugin-sdk";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { useDesignSystems } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";

/**
 * 侧边栏「设计」页的风格库。
 *
 * 两种形态共用一份数据与卡片内容：
 * - `hero`：画廊还空着时它是首屏主角，铺开成网格——新用户点一套风格就能开工，比对着
 *   空白画布想第一句话快得多。
 * - `strip`：已经有设计了，退成底部一条横滑，不跟用户自己的作品抢位置。
 *
 * 列表来自 registry，远端清单到货时这里会自动跟着更新。
 */
export interface DesignSystemStripProps {
	variant: "hero" | "strip";
	busy: boolean;
	onPick: (system: DesignSystem) => void;
}

export function DesignSystemStrip({ variant, busy, onPick }: DesignSystemStripProps) {
	const { t } = useTranslation();
	const systems = useDesignSystems();
	if (systems.length === 0) return null;

	const isHero = variant === "hero";
	return (
		<section className={isHero ? "flex min-h-0 flex-col gap-3" : "flex shrink-0 flex-col gap-2 border-t border-border px-4 py-3"}>
			<header className="flex min-w-0 items-baseline gap-2">
				<h2 className={isHero ? "text-sm font-medium text-foreground" : "text-xs font-medium text-foreground"}>
					{t("gallery.styles.title")}
				</h2>
				<p className="min-w-0 truncate text-[11px] text-muted-foreground">{t("gallery.styles.hint")}</p>
			</header>
			<div
				className={
					isHero
						? "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 overflow-y-auto"
						: "flex gap-2.5 overflow-x-auto pb-1"
				}
			>
				{systems.map((system) => (
					<button
						key={system.id}
						type="button"
						disabled={busy}
						onClick={() => onPick(system)}
						aria-label={t("gallery.styles.start", { name: system.name })}
						className={`flex aspect-square min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border border-border p-2 text-left transition-all duration-200 hover:border-primary hover:shadow-sm disabled:opacity-40 ${
							isHero ? "" : "w-[132px] shrink-0"
						}`}
					>
						<DesignSystemTileContent system={system} />
					</button>
				))}
			</div>
		</section>
	);
}
