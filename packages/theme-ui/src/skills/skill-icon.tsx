import type { JSX } from "react";

/**
 * 与 admin `MarketIconField` 预设对齐的 30 个 Solar 实心图标。
 * 使用字面量 class，保证 Tailwind + @iconify/tailwind4 能扫到。
 */
export const SOLAR_SKILL_ICON_CLASS: Readonly<Record<string, string>> = {
	"solar:star-bold": "icon-[solar--star-bold]",
	"solar:magic-stick-3-bold": "icon-[solar--magic-stick-3-bold]",
	"solar:bolt-bold": "icon-[solar--bolt-bold]",
	"solar:fire-bold": "icon-[solar--fire-bold]",
	"solar:heart-bold": "icon-[solar--heart-bold]",
	"solar:cup-star-bold": "icon-[solar--cup-star-bold]",
	"solar:code-bold": "icon-[solar--code-bold]",
	"solar:widget-2-bold": "icon-[solar--widget-2-bold]",
	"solar:layers-bold": "icon-[solar--layers-bold]",
	"solar:cpu-bolt-bold": "icon-[solar--cpu-bolt-bold]",
	"solar:database-bold": "icon-[solar--database-bold]",
	"solar:cloud-bold": "icon-[solar--cloud-bold]",
	"solar:server-bold": "icon-[solar--server-bold]",
	"solar:shield-bold": "icon-[solar--shield-bold]",
	"solar:lock-keyhole-bold": "icon-[solar--lock-keyhole-bold]",
	"solar:key-bold": "icon-[solar--key-bold]",
	"solar:chat-round-bold": "icon-[solar--chat-round-bold]",
	"solar:letter-bold": "icon-[solar--letter-bold]",
	"solar:document-bold": "icon-[solar--document-bold]",
	"solar:folder-bold": "icon-[solar--folder-bold]",
	"solar:gallery-bold": "icon-[solar--gallery-bold]",
	"solar:camera-bold": "icon-[solar--camera-bold]",
	"solar:videocamera-record-bold": "icon-[solar--videocamera-record-bold]",
	"solar:music-note-bold": "icon-[solar--music-note-bold]",
	"solar:chart-2-bold": "icon-[solar--chart-2-bold]",
	"solar:graph-up-bold": "icon-[solar--graph-up-bold]",
	"solar:map-point-bold": "icon-[solar--map-point-bold]",
	"solar:global-bold": "icon-[solar--global-bold]",
	"solar:rocket-2-bold": "icon-[solar--rocket-2-bold]",
	"solar:lightbulb-bolt-bold": "icon-[solar--lightbulb-bolt-bold]",
};

export function isSolarSkillIcon(icon: string | null | undefined): boolean {
	return !!icon && icon.startsWith("solar:");
}

/**
 * 可否作为 `<img src>` 渲染。
 *
 * 与能力广场 `isRenderableImageIcon` 对齐：开源市场图标解析后是
 * `vetta-file://local/...`（见 open-marketplace-presentation），只认 http(s)
 * 会让命令面板 / skill 胶囊全部退回默认立方体，看起来像「没有图标」。
 * `solar:` 仍走 Iconify，不进这里。
 */
export function isImageSkillIcon(icon: string | null | undefined): boolean {
	if (!icon) return false;
	const v = icon.trim();
	if (!v || v.startsWith("solar:")) return false;
	return (
		// http(s) / blob / file / vetta-file 等任意 scheme://
		v.includes("://") ||
		v.startsWith("/") ||
		// `./skills/xxx.png`：宿主内置 Skill 的图标是相对路径（打包后走 file://，vite base 为 "./"）
		v.startsWith("./") ||
		// data:image/... 没有 "://"
		v.startsWith("data:")
	);
}

export interface SkillTypeIconProps {
	readonly type: "skill" | "scene";
	/** 空 / 未识别 → 按 type 显示默认图标 */
	readonly icon?: string | null;
	readonly className?: string;
}

/**
 * Skill 未配置 icon 时的默认 3D 方块：浅色 `#1C274C`，深色白色。
 */
export function SkillDefaultIcon({ className = "h-4 w-4" }: { className?: string }): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={`${className} text-[#1C274C] dark:text-white`}
			aria-hidden
		>
			<path
				d="M17.5777 4.43152L15.5777 3.38197C13.8221 2.46066 12.9443 2 12 2C11.0557 2 10.1779 2.46066 8.42229 3.38197L8.10057 3.5508L17.0236 8.64967L21.0403 6.64132C20.3941 5.90949 19.3515 5.36234 17.5777 4.43152Z"
				fill="currentColor"
			/>
			<path
				d="M21.7484 7.96434L17.75 9.96353V13C17.75 13.4142 17.4142 13.75 17 13.75C16.5858 13.75 16.25 13.4142 16.25 13V10.7135L12.75 12.4635V21.904C13.4679 21.7252 14.2848 21.2965 15.5777 20.618L17.5777 19.5685C19.7294 18.4393 20.8052 17.8748 21.4026 16.8603C22 15.8458 22 14.5833 22 12.0585V11.9415C22 10.0489 22 8.86557 21.7484 7.96434Z"
				fill="currentColor"
			/>
			<path
				d="M11.25 21.904V12.4635L2.25164 7.96434C2 8.86557 2 10.0489 2 11.9415V12.0585C2 14.5833 2 15.8458 2.5974 16.8603C3.19479 17.8748 4.27062 18.4393 6.42228 19.5685L8.42229 20.618C9.71524 21.2965 10.5321 21.7252 11.25 21.904Z"
				fill="currentColor"
			/>
			<path
				d="M2.95969 6.64132L12 11.1615L15.4112 9.4559L6.52456 4.37785L6.42229 4.43152C4.64855 5.36234 3.6059 5.90949 2.95969 6.64132Z"
				fill="currentColor"
			/>
		</svg>
	);
}

/**
 * 技能卡片图标：自定义图 → Solar 实心 → type 默认图标。
 * 图片铺满父容器（h-full w-full）；字体/Solar/默认 SVG 使用 className 尺寸。
 * skill 默认：3D 方块（浅色 `#1C274C` / 深色白）；scene 默认：mdi 影片。
 */
export function SkillTypeIcon({ type, icon, className = "h-4 w-4" }: SkillTypeIconProps): JSX.Element {
	const trimmed = icon?.trim() ?? "";
	if (trimmed && isImageSkillIcon(trimmed)) {
		return <img src={trimmed} alt="" className="h-full w-full object-contain" />;
	}
	if (trimmed && isSolarSkillIcon(trimmed)) {
		const cls = SOLAR_SKILL_ICON_CLASS[trimmed];
		if (cls) {
			return <span className={`${className} ${cls}`} />;
		}
	}
	if (type === "scene") {
		return <span className={`${className} icon-[mdi--movie-open-outline]`} />;
	}
	return <SkillDefaultIcon className={className} />;
}
