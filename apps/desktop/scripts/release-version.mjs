// 桌面端发布版本同时用于安装包文件名、更新清单与版本目录，格式必须与
// prepare-pack.js 及 scripts/release/resolve-desktop-release-config.mjs 一致：
// 正式版 x.y.z，预发布版 x.y.z-N。
export const DESKTOP_RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(-\d+)?$/;

export function isDesktopReleaseVersion(value) {
	return typeof value === "string" && DESKTOP_RELEASE_VERSION_PATTERN.test(value);
}
