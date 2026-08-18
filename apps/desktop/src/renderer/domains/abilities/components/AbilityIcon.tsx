import { SkillDefaultIcon, SkillTypeIcon } from "@vetta/theme-ui/skills";
import { cn } from "@vetta/ui";
import { useState } from "react";
import type { AbilityType } from "@shared/lib/api";
import { ABILITY_TYPE_ICON, isIconifyIcon, isRenderableImageIcon } from "../lib/ability-presentation";

/**
 * 统一图标三态：空=按 type 落默认图 / `solar:xxx`=Iconify / 其余=图片 URL。
 * 图片加载失败自动退回默认图（插件包内图在插件重载期间可能短暂 404）。
 */
export function AbilityIcon({
	icon,
	type,
	className,
	iconClassName = "h-5 w-5",
}: {
	icon?: string;
	type: AbilityType;
	className?: string;
	iconClassName?: string;
}): JSX.Element {
	const [failedIcon, setFailedIcon] = useState<string | null>(null);
	const showImage = isRenderableImageIcon(icon) && failedIcon !== icon;

	return (
		<div
			className={cn(
				"flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/40 bg-accent/50 text-foreground",
				className,
			)}
		>
			{showImage && icon ? (
				<img src={icon} alt="" className="h-full w-full object-contain" onError={() => setFailedIcon(icon)} />
			) : isIconifyIcon(icon) ? (
				<SkillTypeIcon type={type === "scene" ? "scene" : "skill"} icon={icon} className={iconClassName} />
			) : type === "skill" ? (
				<SkillDefaultIcon className={iconClassName} />
			) : (
				<span className={cn(iconClassName, ABILITY_TYPE_ICON[type], "text-muted-foreground")} />
			)}
		</div>
	);
}
