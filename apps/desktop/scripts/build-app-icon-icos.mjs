/**
 * 为每个可选应用图标生成 Windows 用的 .ico。
 *
 * 为什么需要：Windows 任务栏上「固定项」的图标来自快捷方式的 IconLocation，而
 * IconLocation 只接受 .ico/.exe/.dll，不能直接指向 PNG。exe 内嵌图标在签名之后就不能再改
 * （改了就作废 Authenticode 签名），所以「设置里换图标 → 任务栏跟着换」只能靠
 * 「每个 id 一个 .ico + 改快捷方式指向」。
 *
 * 产物：`build/app-icon-icos/<id>.ico`，与 `build/app-icons/<id>-win.png` 一一对应；
 * `default` 直接复用打包图标 `build/icon.ico`。资源过滤（build-resource-filters.mjs）
 * 会把它带进安装包。
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

const require = createRequire(import.meta.url);
const { appBuilderPath } = require("app-builder-bin");

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
];

/** 与运行时 `appIconFileSuffix()` 保持一致：Windows 用 -win 取景。 */
export function appIconSourceName(id) {
	return `${id}-win.png`;
}

/**
 * @param {object} options
 * @param {string} options.buildDir  apps/desktop/build
 * @param {(cmd: string, args: string[]) => unknown} [options.run]
 */
export async function buildAppIconIcos({ buildDir, run = execFileSync } = {}) {
	const iconsDir = join(buildDir, "app-icons");
	const outputDir = join(buildDir, "app-icon-icos");
	await rm(outputDir, { recursive: true, force: true });
	await mkdir(outputDir, { recursive: true });

	const built = [];
	const missing = [];

	const defaultIcon = join(buildDir, "icon.ico");
	if (existsSync(defaultIcon)) {
		await copyFile(defaultIcon, join(outputDir, "default.ico"));
		built.push("default");
	} else {
		missing.push("icon.ico");
	}

	for (const id of APP_ICON_IDS) {
		if (id === "default") continue;
		const source = join(iconsDir, appIconSourceName(id));
		if (!existsSync(source)) {
			missing.push(basename(source));
			continue;
		}
		// app-builder 的 icon 命令与打包链路共用同一套转换；它固定输出 icon.ico，
		// 所以每个 id 用独立目录，再改名成 <id>.ico。
		const stageDir = join(outputDir, `.stage-${id}`);
		await mkdir(stageDir, { recursive: true });
		run(appBuilderPath, ["icon", "--format=ico", `--root=${iconsDir}`, `--out=${stageDir}`, `--input=${source}`], {
			stdio: "ignore",
		});
		await rename(join(stageDir, "icon.ico"), join(outputDir, `${id}.ico`));
		await rm(stageDir, { recursive: true, force: true });
		built.push(id);
	}

	return { outputDir, built, missing };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
	const buildDir = join(import.meta.dirname, "..", "build");
	const result = await buildAppIconIcos({ buildDir });
	const produced = existsSync(result.outputDir) ? (await readdir(result.outputDir)).filter((n) => n.endsWith(".ico")) : [];
	console.log(`[app-icon-icos] ${produced.length} 个 ico → ${result.outputDir}`);
	if (result.missing.length > 0) {
		console.warn(`[app-icon-icos] 缺少源图：${result.missing.join(", ")}`);
	}
}
