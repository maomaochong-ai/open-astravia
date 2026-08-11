import { useTranslation } from "@vetta-org/plugin-sdk";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { useDesignSystems } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";

/**
 * 侧边栏「设计」页的风格库：和项目卡片同一套宫格语言，作为页面内容的一部分往下滚。
 *
 * 位置由调用方决定——画廊空着时它排在引导语下面当首屏主角，已经有设计时排在项目宫格
 * 之后、用一条分隔线隔开。列表来自 registry，远端清单到货时这里会自动跟着更新。
 */
export interface DesignSystemGridProps {
	/** 上方还有别的内容时画一条分隔线，避免和项目宫格糊成一片。 */
	divided?: boolean;
	busy: boolean;
	onPick: (system: DesignSystem) => void;
}

export function DesignSystemGrid({ divided = false, busy, onPick }: DesignSystemGridProps) {
	const { t } = useTranslation();
	const systems = useDesignSystems();
	if (systems.length === 0) return null;

	return (
		<section className={divided ? "mt-6 border-t border-border pt-5" : ""}>
			<header className="mb-3 flex min-w-0 items-baseline gap-2">
				<h2 className="shrink-0 text-sm font-medium text-foreground">{t("gallery.styles.title")}</h2>
				<p className="min-w-0 truncate text-[11px] text-muted-foreground">{t("gallery.styles.hint")}</p>
			</header>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
				{systems.map((system) => (
					<button
						key={system.id}
						type="button"
						disabled={busy}
						onClick={() => onPick(system)}
						aria-label={t("gallery.styles.start", { name: system.name })}
						className="flex aspect-square min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border border-border p-2 text-left transition-all duration-200 hover:border-primary hover:shadow-sm disabled:opacity-40"
					>
						<DesignSystemTileContent system={system} />
					</button>
				))}
			</div>
		</section>
	);
}
