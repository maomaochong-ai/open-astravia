import { useTranslation } from "@astravia-org/plugin-sdk";
import { DesignSystemPreview } from "../canvas/DesignSystemPreview";
import { designSystemTagline } from "../design-systems/labels";
import type { DesignSystem } from "../design-systems/types";

/**
 * 画廊里的风格卡：与项目卡 {@link GalleryCard} 同构——16:10 预览 + 两行信息。
 *
 * 预览直接用 `DesignSystemPreview`（用该风格的令牌画界面骨架），不挂 HTML demo：
 * 风格墙几十套连排，全挂 iframe 会拖垮滚动；纯 token 骨架没有这个成本，也不需要
 * 「悬停才挂 demo」的额外状态。名称 + 一句风格摘要就是全部信息。
 */
export interface GallerySystemCardProps {
	system: DesignSystem;
	onPick: (system: DesignSystem) => void;
	/** 正在建项目等忙态时禁用，避免重复建。 */
	disabled?: boolean;
}

export function GallerySystemCard({ system, onPick, disabled = false }: GallerySystemCardProps) {
	const { t, locale } = useTranslation();
	const tagline = designSystemTagline(system, locale, t);

	return (
		<button
			type="button"
			disabled={disabled}
			onClick={() => onPick(system)}
			aria-label={t("gallery.styles.view", { name: system.name })}
			className="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg disabled:opacity-40"
		>
			<div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/40">
				<DesignSystemPreview system={system} className="h-full w-full rounded-none border-0" />
			</div>
			<div className="flex flex-col gap-0.5 px-3 py-2.5">
				<span className="truncate text-sm font-medium text-foreground">{system.name}</span>
				<span className="truncate text-xs text-muted-foreground">{tagline}</span>
			</div>
		</button>
	);
}
