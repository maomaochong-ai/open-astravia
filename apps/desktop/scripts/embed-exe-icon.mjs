/**
 * 给 Windows PE 的可执行文件嵌入应用图标。
 *
 * 任务栏固定项显示的图标来自**快捷方式目标 exe 的内嵌图标**，不是
 * `BrowserWindow.setIcon()`（后者只影响窗口本身与未固定的按钮）。因此 dev 下的
 * electron.exe、打包后 `versions/<版本>/Astravia.exe` 与 Go 启动器都必须带同一套图标，
 * 否则固定到任务栏后会退到 Electron 自带图标。
 *
 * 只改写图标的资源段（RT_GROUP_ICON / RT_ICON），其余资源与代码原样保留。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** 图标组 ID 与语言（en-US）：资源段里不存在时会追加，存在则整体替换。 */
const ICON_GROUP_ID = 1;
const ICON_LANGUAGE_ID = 0x409;

export async function embedExeIcon(exePath, iconPath) {
	const { Data, NtExecutable, NtExecutableResource, Resource } = require("resedit");
	const executable = NtExecutable.from(await readFile(exePath));
	const res = NtExecutableResource.from(executable);
	const iconFile = Data.IconFile.from(await readFile(iconPath));
	Resource.IconGroupEntry.replaceIconsForResource(
		res.entries,
		ICON_GROUP_ID,
		ICON_LANGUAGE_ID,
		iconFile.icons.map((icon) => icon.data),
	);
	res.outputResource(executable);
	await writeFile(exePath, Buffer.from(executable.generate()));
	return iconFile.icons.length;
}

export async function hashFile(path) {
	const hash = createHash("sha256");
	hash.update(await readFile(path));
	return hash.digest("hex");
}

/**
 * dev 用的幂等判定：图标内容或 exe 本身变化时才重新写入。
 * 状态单独存一份，避免每次 `bun run dev` 都重写 180 MB 的二进制。
 */
export function needsIconPatch(recorded, current) {
	if (!recorded) return true;
	return recorded.exeMtimeMs !== current.exeMtimeMs || recorded.iconSha !== current.iconSha;
}

export function devIconStatePath(projectRoot) {
	return join(projectRoot, "node_modules", ".cache", "astravia-dev-electron-icon.json");
}

/**
 * dev 启动前调用：把 build/icon.ico 写进 dev 用的 electron.exe。
 *
 * 失败只警告并继续——图标不对不该阻塞开发；常见原因是该进程正被运行中的实例占用。
 */
export async function applyDevExeIcon({ exePath, iconPath, projectRoot, log = console.log }) {
	const statePath = devIconStatePath(projectRoot);
	const [exeStat, iconSha] = await Promise.all([stat(exePath), hashFile(iconPath)]);
	const current = { exePath, exeMtimeMs: Math.round(exeStat.mtimeMs), iconSha };

	let recorded;
	try {
		recorded = JSON.parse(await readFile(statePath, "utf8"));
	} catch {
		recorded = undefined;
	}

	if (recorded?.exePath === exePath && !needsIconPatch(recorded, current)) return false;

	const iconCount = await embedExeIcon(exePath, iconPath);
	await mkdir(dirname(statePath), { recursive: true });
	const patched = { ...current, exeMtimeMs: Math.round((await stat(exePath)).mtimeMs), iconCount };
	await writeFile(statePath, `${JSON.stringify(patched)}\n`, "utf8");
	log(`[dev] embedded app icon into ${exePath} (${iconCount} sizes)`);
	return true;
}
