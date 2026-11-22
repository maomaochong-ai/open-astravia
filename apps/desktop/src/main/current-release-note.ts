import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripReleaseNoteHeader } from "../shared/release-note-header.js";

export { stripReleaseNoteHeader };

export interface CurrentReleaseNoteOptions {
	readonly version: string;
	readonly isPackaged: boolean;
	readonly resourcesPath: string;
	readonly cwd: string;
}

/**
 * 随包发布说明的路径。
 *
 * 打包后由 prepare-pack 放进 `Resources/release-notes/v<版本>.md`；开发态直接读仓库里的
 * `.github/release-notes`（cwd 为 apps/desktop）。单独暴露是为了在缺失时能打出**具体路径**
 * ——「暂无这个版本的介绍」本身不告诉任何人文件该放哪。
 */
export function currentReleaseNotePath(options: CurrentReleaseNoteOptions): string {
	const fileName = `v${options.version}.md`;
	return options.isPackaged
		? join(options.resourcesPath, "release-notes", fileName)
		: join(options.cwd, "..", "..", ".github", "release-notes", fileName);
}

/**
 * 当前版本的发布说明（Markdown，已去掉标题）。
 *
 * 文件名与 `app.getVersion()` 必须逐字一致：版本升了却没建对应文件时，界面上只会显示
 * 「暂无这个版本的介绍」。这种失败在用户侧看不出来，所以由调用方把路径打进日志。
 */
export function readCurrentReleaseNote(options: CurrentReleaseNoteOptions): string | undefined {
	const filePath = currentReleaseNotePath(options);
	if (!existsSync(filePath)) return undefined;
	try {
		return stripReleaseNoteHeader(readFileSync(filePath, "utf-8")) || undefined;
	} catch {
		return undefined;
	}
}
