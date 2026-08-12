/**
 * 设计历史的插件侧入口（ADR-0069）。其余代码只认这几个方法，不知道 git 存在。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { runHistoryCommand } from "./runner-host";

/** 一个设计版本。`files` 是提交时就算好的变更清单，不需要事后算 diff。 */
export interface HistoryCommit {
	sha: string;
	title: string;
	/** 毫秒时间戳。 */
	timestamp: number;
	files: string[];
	/** 这是一次「恢复」，指向被恢复的源版本。 */
	restoredFrom?: string;
}

/** 仓库不在就建。已经建过是廉价的空操作。 */
export async function ensureHistory(ctx: PluginContext, designDir: string): Promise<{ hasCommits: boolean }> {
	const result = await runHistoryCommand<{ hasCommits: boolean }>(ctx, { cmd: "init", dir: designDir });
	return { hasCommits: result.hasCommits };
}

/**
 * 落一个版本。没有实际变更时不产生空提交，返回 null——调用方据此决定要不要
 * 刷新历史面板。
 */
export async function commitHistory(
	ctx: PluginContext,
	designDir: string,
	title: string,
): Promise<HistoryCommit | null> {
	const result = await runHistoryCommand<{ committed: boolean; commit: HistoryCommit | null }>(ctx, {
		cmd: "commit",
		dir: designDir,
		title,
	});
	return result.committed ? result.commit : null;
}

export async function listHistory(ctx: PluginContext, designDir: string, limit = 100): Promise<HistoryCommit[]> {
	const result = await runHistoryCommand<{ commits: HistoryCommit[] }>(ctx, {
		cmd: "log",
		dir: designDir,
		limit,
	});
	return result.commits;
}

/**
 * 恢复到某个版本：内容写回工作区，再落一个新提交。历史只增不减，所以恢复错了
 * 可以再恢复回去。调用方负责在此之前封存当前未提交的现场。
 */
export async function restoreHistory(
	ctx: PluginContext,
	designDir: string,
	sha: string,
	title: string,
): Promise<HistoryCommit | null> {
	const result = await runHistoryCommand<{ committed: boolean; commit: HistoryCommit | null }>(ctx, {
		cmd: "restore",
		dir: designDir,
		sha,
		title,
	});
	return result.committed ? result.commit : null;
}

/** 某个版本里一个文件的内容；不存在返回 null。 */
export async function readHistoryFile(
	ctx: PluginContext,
	designDir: string,
	sha: string,
	filepath: string,
): Promise<string | null> {
	const result = await runHistoryCommand<{ content: string | null }>(ctx, {
		cmd: "show",
		dir: designDir,
		sha,
		filepath,
	});
	return result.content;
}
