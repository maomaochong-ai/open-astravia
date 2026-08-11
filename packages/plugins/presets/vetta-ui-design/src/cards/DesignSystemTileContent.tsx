import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ReactNode } from "react";
import { DesignSystemPreview } from "../canvas/DesignSystemPreview";
import { DesignSystemDemo, designSystemDemoHtml } from "../gallery/DesignSystemDemo";
import { designSystemCategoryLabel, designSystemTagline } from "../design-systems/labels";
import type { DesignSystem } from "../design-systems/types";

/**
 * 设计体系卡片的公共内容块：缩略预览 + 明暗点 + 名称 + 类目 + 标语。
 * 会话宫格与全局模板 Dialog 共用，选中/锁定等状态样式由外层按钮负责。
 */
export function DesignSystemTileContent({
	system,
	badge,
	demoActive = false,
}: {
	system: DesignSystem;
	/** 名称右侧的状态徽标（「已选择」/「当前」），没有就不占位。 */
	badge?: ReactNode;
	/** 悬停态：有 demo 时让预览自动滚动。 */
	demoActive?: boolean;
}) {
	const { t, locale } = useTranslation();
	// 有 HTML demo 就用真实渲染当预览，没有才退回 token 色块。
	const hasDemo = designSystemDemoHtml(system) !== null;
	return (
		<>
			{/* 预览区弹性吃掉剩余高度：外层卡片是 1:1 正方形，文字两行定高在底部。 */}
			{hasDemo ? (
				<DesignSystemDemo system={system} active={demoActive} className="min-h-0 flex-1 rounded-md" />
			) : (
				<DesignSystemPreview system={system} className="min-h-0 flex-1" />
			)}
			<div className="flex min-w-0 items-center gap-1.5 px-0.5">
				<span
					title={t(system.vibe === "dark" ? "ds.vibe.dark" : "ds.vibe.light")}
					className={`size-2 shrink-0 rounded-full border ${
						system.vibe === "dark" ? "border-zinc-500 bg-zinc-900" : "border-zinc-300 bg-zinc-50"
					}`}
				/>
				<span className="truncate text-xs font-semibold text-foreground">{system.name}</span>
				{badge}
				<span className="flex-1" />
				<span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] text-muted-foreground">
					{designSystemCategoryLabel(system, t)}
				</span>
			</div>
			<div className="min-w-0 truncate px-0.5 text-[11px] leading-tight text-muted-foreground">
				{designSystemTagline(system, locale, t)}
			</div>
		</>
	);
}
