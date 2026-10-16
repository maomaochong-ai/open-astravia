// 桌面端发布版本同时用于安装包文件名、更新清单与版本目录，格式必须与
// prepare-pack.js 及 scripts/release/resolve-desktop-release-config.mjs 一致：
// 正式版 x.y.z，预发布版 x.y.z-N。
export const DESKTOP_RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(-\d+)?$/;

export function isDesktopReleaseVersion(value) {
	return typeof value === "string" && DESKTOP_RELEASE_VERSION_PATTERN.test(value);
}

// Inno Setup 的 VersionInfoVersion 只接受四个数字段（a.b.c.d，每段 0-65535），
// 预发布后缀折进第四段；安装包文件名与更新清单仍使用原始版本号。
const VERSION_INFO_PART_LIMIT = 65535;

export function desktopVersionInfoVersion(value) {
	if (!isDesktopReleaseVersion(value)) throw new Error(`invalid desktop release version: ${value}`);
	const [, major, minor, patch, preRelease] = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/);
	const parts = [major, minor, patch, preRelease ?? "0"].map(Number);
	if (parts.some((part) => part > VERSION_INFO_PART_LIMIT)) {
		throw new Error(`desktop release version exceeds the VersionInfoVersion range: ${value}`);
	}
	return parts.join(".");
}
