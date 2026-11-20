import { TokenChip } from "./TokenChip";

/**
 * 行内插件胶囊。
 *
 * 插件在输入框里必须与技能、连接器同一种胶囊形态：图标要么是市场给的图片 URL，
 * 要么退回统一的插件图标。`TokenChip` 负责裁圆角与对齐正文。
 */
export function PluginTokenChip({
	name,
	label,
	icon,
}: {
	name: string;
	label?: string;
	icon?: string;
}): JSX.Element {
	// `solar:` 图标需要静态类名才能被 Tailwind 扫到；插件图标基本是图片，
	// 这里不做动态拼接，非图片一律走兜底类。
	const iconUrl = icon && !icon.startsWith("solar:") ? icon : undefined;
	return (
		<TokenChip
			icon={iconUrl ? undefined : "icon-[solar--widget-2-linear]"}
			iconUrl={iconUrl}
			label={label || name}
			title={name}
		/>
	);
}
