import type { PluginCommandApi } from "@vetta-org/plugin-sdk";

/** 活动面板标签卡 id（与 registerActivityTab 的 contribution id 一致）。 */
export const CHANGES_TAB_ID = "changes";

/**
 * cwd 是否落在一个 git 工作区里。`git rev-parse --is-inside-work-tree` 在非仓库
 * 目录退出码非 0（stderr 是 "not a git repository"），仓库内输出 "true"；bare 仓库
 * 输出 "false"，此时没有可看的工作区变更，同样当作不在仓库。
 */
export async function isInsideGitWorkTree(command: PluginCommandApi, cwd: string): Promise<boolean> {
	try {
		const { stdout, exitCode } = await command.run("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd,
			timeoutMs: 5_000,
		});
		return exitCode === 0 && stdout.trim() === "true";
	} catch {
		// 命令被禁用 / 超时 / 没装 git：一律当作不在仓库，标签卡不上栏。
		return false;
	}
}
