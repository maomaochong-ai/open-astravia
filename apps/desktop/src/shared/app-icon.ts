/**
 * 应用图标（设置 → 外观 → 应用图标）。
 *
 * 主进程持久化并套用，renderer 只读写同一个 id；预览图与打包用的图标资源
 * 分别位于 `settings/assets/app-icons/` 与 `build/app-icons/`。
 */

/** 可选图标：`default` 是出厂图标，其余是场景图标（图片在 `build/app-icons/<id>.png`）。 */
export const APP_ICON_IDS = [
	"default",
	"coding",
	"design",
	"work",
	"study",
	"read",
	"game",
	"sport",
	"cook",
	"travel",
	"sleep",
] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];

export const APP_ICON_DEFAULT: AppIconId = "default";

export function isAppIconId(value: unknown): value is AppIconId {
	return typeof value === "string" && (APP_ICON_IDS as readonly string[]).includes(value);
}

/** 未知或缺失的值回落默认，兼容将来删减图标后的旧配置。 */
export function normalizeAppIconId(value: unknown): AppIconId {
	return isAppIconId(value) ? value : APP_ICON_DEFAULT;
}
