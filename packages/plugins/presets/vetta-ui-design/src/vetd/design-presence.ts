import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { pickDesignPaths } from "./discover";

/**
 * 「当前工作区里到底有没有设计稿」的单一事实源。
 *
 * 存在的理由是工具闸门（{@link ../vetd/tool-gate}）要在**每一次模型调用前**回答这个
 * 问题，而唯一的判定手段是递归列举整个 cwd——放在那条热路径上跑，代码仓库越大越贵。
 * 所以这里把结果按 cwd 记住，并让已经在做全量列举的调用方（会话切换时的 Tab 判定）
 * 顺手把结论喂进来：正常情况下闸门一次磁盘都不碰。
 */
const presenceByCwd = new Map<string, boolean>();

/** 已经拿到文件列表的调用方把结论喂进来（会话切换、vetd_create 落盘后）。 */
export function setDesignPresence(cwd: string, present: boolean): void {
	presenceByCwd.set(cwd, present);
}

/** 缓存里已有的结论；没探测过就是 undefined。 */
export function cachedDesignPresence(cwd: string): boolean | undefined {
	return presenceByCwd.get(cwd);
}

/** 测试用：清掉进程内缓存。 */
export function resetDesignPresence(): void {
	presenceByCwd.clear();
}

/**
 * cwd 里有没有设计稿。第一次探测会列举一次工作区，之后走缓存。
 *
 * 列举失败按「没有」处理：闸门在拿不准时该关，误开的代价是模型又在纯代码仓库里
 * 看见一排设计工具。
 */
export async function hasDesignInWorkspace(fs: PluginFsApi, cwd: string): Promise<boolean> {
	const cached = presenceByCwd.get(cwd);
	if (cached !== undefined) return cached;
	const files = await fs.listFilesRecursive(cwd).catch(() => []);
	const { bundles, legacyFiles } = pickDesignPaths(files);
	const present = bundles.length + legacyFiles.length > 0;
	presenceByCwd.set(cwd, present);
	return present;
}
