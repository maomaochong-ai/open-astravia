/**
 * 恢复到某个历史版本（ADR-0069）。
 *
 * 恢复不是回退：内容写回工作区之后再落一个新提交，历史只增不减。所以恢复错了可以
 * 再恢复回去，不存在不可逆的误操作。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { installDesignDependencies } from "../engine/engine-manager";
import { PACKAGE_FILE } from "../vetd/design-package";
import type { DesignSession } from "../vetd/design-session";
import { type HistoryCommit, commitHistory, restoreHistory } from "./history-client";
import { notifyHistoryChanged } from "./history-events";
import { PRE_RESTORE_TITLE, restoreTitle } from "./turn-title";

export interface RestoreOutcome {
	/** 恢复产生的新版本。目标版本与当前内容完全一致时为 null（无事可做）。 */
	restored: HistoryCommit | null;
	/** 恢复动作之前封存的现场；工作区本来就干净时为 null。 */
	stashed: HistoryCommit | null;
	/** 是否重装了依赖。 */
	reinstalled: boolean;
}

/**
 * 恢复后依赖清单可能变了（那一版装过 recharts、当前没有，或者反过来）。
 *
 * 不能沿用 `needsDependencyInstall` 的判据——它问的是「node_modules 在不在」，而这里
 * node_modules 明明在，只是内容对不上清单，vite 首次 import 才会炸。
 */
function dependenciesChanged(commit: HistoryCommit | null): boolean {
	return commit?.files.includes(PACKAGE_FILE) ?? false;
}

/**
 * 三步：封存现场 → 写回目标版本 → 让画布与依赖跟上。
 *
 * 第一步是必需的而不是保险：被用户按停止中断的那一轮改动从没被提交过（Stop hook 在
 * aborted 时不触发），不先封存就会在这一步被覆盖掉。
 */
export async function restoreDesign(
	ctx: PluginContext,
	designDir: string,
	target: HistoryCommit,
	options: {
		/** 画布上打开的正是这份设计时传进来，写回后要整份重载。没打开就没有画布要刷。 */
		session?: DesignSession | null;
		onProgress?: (phase: "stashing" | "restoring" | "installing" | "reloading") => void;
	} = {},
): Promise<RestoreOutcome> {
	const { session = null, onProgress } = options;
	onProgress?.("stashing");
	const stashed = await commitHistory(ctx, designDir, PRE_RESTORE_TITLE);

	onProgress?.("restoring");
	const restored = await restoreHistory(ctx, designDir, target.sha, restoreTitle(target.title));

	let reinstalled = false;
	if (dependenciesChanged(restored)) {
		onProgress?.("installing");
		// 空包名列表 = 纯 `npm install`，把 node_modules 对齐到刚写回来的那份清单。
		await installDesignDependencies(ctx, designDir, [], () => {});
		reinstalled = true;
	}

	if (restored) notifyHistoryChanged(designDir);
	if (restored && session) {
		onProgress?.("reloading");
		await session.reload();
	}
	return { restored, stashed, reinstalled };
}
