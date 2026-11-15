import { cn } from "@astravia-org/ui/utils";
import { useState } from "react";

/**
 * 条目图标。
 *
 * 三种来源，一种兜底：
 * 1. `iconUrl`（或 `icon` 被识别为图片，见 `splitIcon`）→ `<img>`；
 * 2. `icon` 是 iconify class → 用 class 的 mask 渲染；
 * 3. 都没有、或图片加载失败 → 分类图标（`fallbackIcon`）。
 *
 * 图片失败要能退回图标：技能图标是插件/市场给的相对路径，条目还在、文件可能已经不在，
 * 那时留一个空洞比显示分类图标更难看（实机上就出现过整行空白）。
 */
export function AddPanelIcon({
	icon,
	iconUrl,
	fallbackIcon,
	boxClassName,
	className,
}: {
	readonly icon?: string;
	readonly iconUrl?: string;
	readonly fallbackIcon: string;
	/** 外层方框（尺寸与底色在各视图不同）。 */
	readonly boxClassName?: string;
	/** 图标本身的尺寸。 */
	readonly className?: string;
}): JSX.Element {
	const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
	const imageUrl = iconUrl && brokenUrl !== iconUrl ? iconUrl : undefined;
	const glyph = imageUrl ? fallbackIcon : (icon ?? fallbackIcon);

	return (
		<span className={cn("flex shrink-0 items-center justify-center overflow-hidden", boxClassName)}>
			{imageUrl ? (
				<img
					src={imageUrl}
					alt=""
					draggable={false}
					onError={() => setBrokenUrl(imageUrl)}
					className={cn("object-contain", className)}
				/>
			) : (
				<span aria-hidden="true" className={cn(glyph, "text-muted-foreground", className)} />
			)}
		</span>
	);
}
