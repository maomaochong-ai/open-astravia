import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { nativeImage } from "electron";

const execFileAsync = promisify(execFile);

/**
 * 取 macOS 应用的图标（PNG data URL），给插件在菜单 / 列表里展示「这个应用」用。
 *
 * 只认标准应用目录里的 `.app`，应用名不能带路径分隔符，所以插件没法借它读任意文件的图标。
 * 应用不存在返回 `null`（插件据此灰掉对应项）。
 */

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._+-]{0,63}$/u;

function appDirectories(): string[] {
	return [
		"/Applications",
		"/System/Applications",
		"/System/Applications/Utilities",
		"/System/Library/CoreServices",
		join(homedir(), "Applications"),
	];
}

/** 在标准应用目录里找 `<name>.app`；名字不合法或找不到返回 `null`。 */
export function resolveAppBundlePath(
	appName: string,
	exists: (path: string) => boolean = existsSync,
	directories: readonly string[] = appDirectories(),
): string | null {
	if (!NAME_PATTERN.test(appName)) return null;
	for (const directory of directories) {
		const candidate = join(directory, `${appName}.app`);
		if (exists(candidate)) return candidate;
	}
	return null;
}

const cache = new Map<string, string>();

/**
 * 读 Info.plist 的 CFBundleIconFile，定位 Resources 里的 .icns。
 * 不用 app.getFileIcon：它在 Electron 线程池里调 NSImage，macOS 新版本上会让主进程直接崩溃。
 */
async function resolveIconFile(bundlePath: string): Promise<string | null> {
	const { stdout } = await execFileAsync(
		"/usr/bin/plutil",
		["-extract", "CFBundleIconFile", "raw", "-o", "-", join(bundlePath, "Contents", "Info.plist")],
		{ timeout: 3000 },
	);
	const name = stdout.trim();
	if (!name || name.includes("/") || name.includes("\\")) return null;
	const file = join(bundlePath, "Contents", "Resources", name.endsWith(".icns") ? name : `${name}.icns`);
	return existsSync(file) ? file : null;
}

export async function getAppBundleIconDataUrl(bundlePath: string): Promise<string | null> {
	const cached = cache.get(bundlePath);
	if (cached) return cached;
	try {
		const iconFile = await resolveIconFile(bundlePath);
		if (!iconFile) return null;
		const image = nativeImage.createFromPath(iconFile);
		if (image.isEmpty()) return null;
		const dataUrl = image.resize({ width: 64, height: 64, quality: "best" }).toDataURL();
		cache.set(bundlePath, dataUrl);
		return dataUrl;
	} catch {
		return null;
	}
}

export async function getAppIconDataUrl(appName: string): Promise<string | null> {
	const cached = cache.get(appName);
	if (cached) return cached;
	const bundlePath = resolveAppBundlePath(appName);
	if (!bundlePath) return null;
	const dataUrl = await getAppBundleIconDataUrl(bundlePath);
	if (dataUrl) cache.set(appName, dataUrl);
	return dataUrl;
}
