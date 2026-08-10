import type { PluginFsApi, PluginFsFileRef } from "@vetta-org/plugin-sdk";

/**
 * Find working-form .vetd files under a scope. Packaged shares are also .vetd —
 * we sniff the first byte on open instead of guessing here; anything inside a
 * sidecar dir is skipped.
 */
export async function findVetdFiles(fs: PluginFsApi, cwd: string): Promise<string[]> {
	try {
		return pickVetdFiles(await fs.listFilesRecursive(cwd));
	} catch {
		return [];
	}
}

export function pickVetdFiles(files: PluginFsFileRef[]): string[] {
	return files
		.filter((file) => file.name.endsWith(".vetd") && !file.relPath.includes(".vetd.d/"))
		.map((file) => file.path)
		.sort();
}

/**
 * 根目录下允许与设计稿共存、仍算「纯设计项目」的元文件。宿主的递归列举跳过
 * 隐藏项（`.git`、`.vetta` 等）和 node_modules/dist 之类，但 `.vetd.d` 工作态
 * 目录不是隐藏目录，其内容会被列出来，判定时单独豁免；这里只需要放过人和
 * Agent 顺手留下的说明文件。
 */
const PURE_PROJECT_META_FILES = new Set(["readme.md", "readme", "license", "license.md", "agents.md", "claude.md"]);

/**
 * 纯设计项目：至少有一份设计稿，且没有别的实质文件。判定放在纯函数里，
 * 因为「自动打开设计面板」是会打断用户的副作用，误判代价比漏判高。
 */
export function isPureDesignProject(files: PluginFsFileRef[]): boolean {
	let hasVetd = false;
	for (const file of files) {
		// sidecar 工作目录（frames/theme/assets 等）是设计稿的一部分，不影响判定。
		if (file.relPath.includes(".vetd.d/")) continue;
		if (file.name.endsWith(".vetd")) {
			hasVetd = true;
			continue;
		}
		const isRootLevel = !file.relPath.includes("/") && !file.relPath.includes("\\");
		if (isRootLevel && PURE_PROJECT_META_FILES.has(file.name.toLowerCase())) continue;
		return false;
	}
	return hasVetd;
}

/** Working form starts with `{` (JSON manifest); packaged form is a zip (`PK`). */
export function sniffVetdKind(head: string): "working" | "packaged" | "unknown" {
	const trimmed = head.trimStart();
	if (trimmed.startsWith("{")) return "working";
	if (head.startsWith("PK")) return "packaged";
	return "unknown";
}
