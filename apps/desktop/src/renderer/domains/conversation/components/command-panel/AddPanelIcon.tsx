import { isIconifyIcon, isRenderableImageIcon } from "@domains/abilities/lib/ability-presentation";
import { SkillDefaultIcon, SkillTypeIcon } from "@astravia-org/theme-ui/skills";
import { cn } from "@astravia-org/ui/utils";
import { useState } from "react";

/** `icon-[solar--x]` / `icon-solar-x` 这类 Tailwind 图标 class（不是 URL，不是 iconify 名）。 */
function isIconClass(value: string | undefined): boolean {
	return Boolean(value && /^icon-/.test(value.trim()));
}

/**
 * 面板条目的图标，判定规则与能力页的 `AbilityIcon` 完全一致：
 *
 * 1. 图片 URL（`https://` / `astravia-plugin://` / `./x.png` / `data:`）→ `<img>`；
 * 2. `solar:xxx` 这类 iconify **名称** → `SkillTypeIcon` 渲染成矢量图；
 * 3. `icon-[solar--x]` 这类 **class**（文件动作与面板自带图标）→ 直接当 class 用；
 * 4. 都没有、或图片加载失败 → 分类兜底图标。
 *
 * 之前只有 1/3 两条分支：`solar:xxx` 被当成 URL 塞进 `<img>`，加载失败后落成灰色方块
 * ——实机上「整列灰色占位符」就是这个原因。
 */
export function AddPanelIcon({
	icon,
	iconUrl,
	fallbackIcon,
	type,
	boxClassName,
	className,
}: {
	readonly icon?: string;
	readonly iconUrl?: string;
	readonly fallbackIcon: string;
	/** 条目类型：`skill` 且没有图标时用技能默认图，与能力页一致（不是分类图标）。 */
	readonly type?: "skill" | "mcp" | "plugin" | "bundle" | "file";
	/** 外层方框（尺寸与底色在各视图不同）。 */
	readonly boxClassName?: string;
	/** 图标本身的尺寸。 */
	readonly className?: string;
}): JSX.Element {
	const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
	const raw = iconUrl ?? icon;
	const imageUrl = isRenderableImageIcon(raw) && brokenUrl !== raw ? raw : undefined;
	const iconifyName = !imageUrl && isIconifyIcon(raw) ? raw : undefined;
	/*
	 * 只有**看起来像 Tailwind 图标 class** 的值才当 class 用。图片加载失败后 `raw` 仍是
	 * 那个 URL，直接当 class 拼进去会得到一个不可见的空元素——那时应当落回兜底图标。
	 */
	const iconClass = !imageUrl && !iconifyName && isIconClass(raw) ? raw : fallbackIcon;

	return (
		<span className={cn("flex shrink-0 items-center justify-center overflow-hidden", boxClassName)}>
			{imageUrl ? (
				<img
					src={imageUrl}
					alt=""
					draggable={false}
					loading="lazy"
					decoding="async"
					onError={() => setBrokenUrl(imageUrl)}
					className={cn("object-contain", className)}
				/>
			) : iconifyName ? (
				<SkillTypeIcon icon={iconifyName} className={cn("text-muted-foreground", className)} />
			) : type === "skill" ? (
				/* 能力页对「无图标的技能」用同一个默认图；面板用分类图标会看起来像另一种东西。 */
				<SkillDefaultIcon className={cn(className)} />
			) : (
				<span aria-hidden="true" className={cn(iconClass, "text-muted-foreground", className)} />
			)}
		</span>
	);
}
