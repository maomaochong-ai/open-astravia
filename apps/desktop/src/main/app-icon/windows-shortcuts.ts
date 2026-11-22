/**
 * Windows：让任务栏固定项 / 桌面快捷方式的图标跟随「设置 → 外观 → 应用图标」。
 *
 * 为什么需要单独一层：
 * - 运行中窗口的按钮图标由 `BrowserWindow.setIcon` 决定，换图标立刻生效；
 * - 但**固定到任务栏**的按钮与桌面快捷方式读的是快捷方式自己的 `IconLocation`，
 *   它只接受 .ico/.exe/.dll，且不会随 setIcon 变化；
 * - exe 内嵌图标在签名之后不能再改（会作废 Authenticode 签名），所以只能把选中图标
 *   落成一份稳定的 .ico，再改写快捷方式指向它。
 *
 * 因此换图标时做三件事：把 `<id>.ico` 复制到用户数据目录、改写指向本应用的快捷方式、
 * 通知资源管理器刷新图标缓存。
 */

import { execFile } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 快捷方式图标指向的稳定路径：跨版本不变，更新应用后仍有效。 */
export function stableAppIconPath(userDataDir: string): string {
	return join(userDataDir, "app-icon.ico");
}

function psQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/**
 * 改写快捷方式的 IconLocation。
 *
 * 只处理目标指向本应用 exe 的快捷方式：同目录下别的应用快捷方式不能被动到。
 * 用 PowerShell 的 WScript.Shell 读写 .lnk —— .lnk 是二进制复合文档，手写解析得不偿失。
 */
export function buildShortcutRewriteScript({
	iconPath,
	appExecutables,
	directories,
}: {
	iconPath: string;
	appExecutables: string[];
	directories: string[];
}): string {
	const exeList = appExecutables.map(psQuote).join(", ");
	const dirList = directories.map(psQuote).join(", ");
	return [
		"$ErrorActionPreference = 'Stop'",
		`$icon = ${psQuote(`${iconPath},0`)}`,
		`$targets = @(${exeList})`,
		`$dirs = @(${dirList})`,
		"$shell = New-Object -ComObject WScript.Shell",
		"$changed = 0",
		"foreach ($dir in $dirs) {",
		"  if (-not (Test-Path -LiteralPath $dir)) { continue }",
		"  foreach ($file in Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -File -ErrorAction SilentlyContinue) {",
		"    try { $shortcut = $shell.CreateShortcut($file.FullName) } catch { continue }",
		"    if (-not $shortcut.TargetPath) { continue }",
		"    $targetName = [System.IO.Path]::GetFileName($shortcut.TargetPath)",
		"    if ($targets -notcontains $targetName) { continue }",
		"    if ($shortcut.IconLocation -eq $icon) { continue }",
		"    $shortcut.IconLocation = $icon",
		"    $shortcut.Save()",
		"    $changed++",
		"  }",
		"}",
		"Write-Output $changed",
	].join("\n");
}

export type ShortcutSyncResult = { changed: number };

/**
 * 同步快捷方式图标。
 *
 * @param iconId 当前选中的图标 id（用于日志）
 * @param options 由调用方注入路径与执行器，测试不需要真实 Windows 环境
 */
export async function syncWindowsShortcutIcons({
	iconSourcePath,
	userDataDir,
	appExecutables,
	directories,
	refreshIconCache = defaultRefreshIconCache,
	run = defaultRunPowerShell,
	copyIcon = copyFile,
	log = console.log,
}: {
	iconSourcePath: string;
	userDataDir: string;
	appExecutables: string[];
	directories: string[];
	refreshIconCache?: () => Promise<void>;
	run?: (script: string) => Promise<string>;
	copyIcon?: (from: string, to: string) => Promise<void>;
	log?: (message: string) => void;
}): Promise<ShortcutSyncResult> {
	const iconPath = stableAppIconPath(userDataDir);
	await mkdir(dirname(iconPath), { recursive: true });
	await copyIcon(iconSourcePath, iconPath);

	const script = buildShortcutRewriteScript({ iconPath, appExecutables, directories });
	const output = await run(script);
	const changed = Number.parseInt(output.trim().split(/\r?\n/).at(-1) ?? "0", 10);
	if (Number.isFinite(changed) && changed > 0) {
		// 需要刷新缓存，否则资源管理器会继续用旧的图标位图。
		await refreshIconCache();
	}
	log(`[app-icon] windows shortcuts updated (${Number.isFinite(changed) ? changed : 0})`);
	return { changed: Number.isFinite(changed) ? changed : 0 };
}

async function defaultRunPowerShell(script: string): Promise<string> {
	const { stdout } = await execFileAsync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
		{ windowsHide: true, timeout: 15_000 },
	);
	return stdout;
}

async function defaultRefreshIconCache(): Promise<void> {
	try {
		await execFileAsync("ie4uinit.exe", ["-show"], { windowsHide: true, timeout: 10_000 });
	} catch {
		// 缓存刷新失败不影响正确性：下次登录或手动刷新即可看到新图标。
	}
}

/** 需要处理的快捷方式目录：任务栏固定项 + 当前用户桌面 + 公共桌面。 */
export function shortcutDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
	const directories: string[] = [];
	const appData = env.APPDATA;
	if (appData)
		directories.push(join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"));
	const userProfile = env.USERPROFILE;
	if (userProfile) directories.push(join(userProfile, "Desktop"));
	if (env.PUBLIC) directories.push(join(env.PUBLIC, "Desktop"));
	return directories;
}
