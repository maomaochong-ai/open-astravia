import { memo } from "react";
import { parseAccentColor } from "../gallery/theme-accent";
import type { DesignSystem } from "../design-systems/types";

/**
 * 设计体系的「品牌图标」：主色圆角方块 + 品牌名首字母。
 *
 * 与能力页 `AbilityIcon` 同一形态（圆角方块 + 居中标识），用于画廊轮播的瓷砖——
 * 轮播语义是「推荐风格」，该显示风格的标识，而不是画一条界面骨架。取不到主色时
 * 退回中性色（与卡片占位色 `parseAccentColor` 同口径）。
 *
 * 用 SVG 而不是 CSS 字号：瓷砖尺寸从 40px 到 100px 不等，SVG 的 viewBox 让方块圆角与
 * 首字母随容器等比缩放，不需要按尺寸算 font-size。
 */
export const DesignSystemMark = memo(function DesignSystemMark({
	system,
	className,
}: {
	system: DesignSystem;
	className?: string;
}) {
	const accent = parseAccentColor(system.themeCss);
	const initial = system.name.trim().charAt(0).toUpperCase() || "?";
	return (
		<svg viewBox="0 0 100 100" className={`block h-full w-full ${className ?? ""}`} aria-hidden>
			<rect width="100" height="100" rx="26" fill={accent ?? "hsl(220 60% 45%)"} />
			<text
				x="50"
				y="50"
				textAnchor="middle"
				dominantBaseline="central"
				fontSize="46"
				fontWeight="600"
				fill="#fff"
			>
				{initial}
			</text>
		</svg>
	);
});
