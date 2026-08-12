/**
 * 临时查看旧版本（ADR-0069）。
 *
 * peek 与 restore 的区别只有一处：peek **不提交**。旧版本的内容被写进工作区，画布照常
 * 热重载，于是看到的是真实、可交互、可翻页的那一版；退出时用 HEAD 覆盖回去，历史里
 * 不留痕迹。
 *
 * 「不提交」是它全部风险的来源，所以有三道闸：
 * 1. 进入前把未提交的现场落成一个版本——否则它会在写回旧版本时被覆盖掉。
 * 2. peek 期间禁止自动提交（见 turn-history），否则回合结束会把旧版本记成新版本。
 * 3. 磁盘上留一个标记，崩溃/强退后下次打开设计时自动退回最新版。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { DesignSession } from "../vetd/design-session";
import { commitHistory, listHistory } from "./history-client";
import { historyDirOf } from "./history-paths";
import { runHistoryCommand } from "./runner-host";

/** 标记文件。放在 gitdir 里：它不是设计内容，也不该进用户的 git 或分享包。 */
function peekMarkerPath(designDir: string): string {
	return `${historyDirOf(designDir)}/peek.json`;
}

export interface PeekState {
	/** 正在查看的版本。 */
	sha: string;
	title: string;
	/** 退出时要写回的版本——进入 peek 那一刻的 HEAD。 */
	returnTo: string;
}

export async function readPeekState(ctx: PluginContext, designDir: string): Promise<PeekState | null> {
	try {
		const { content } = await ctx.fs.readFile(peekMarkerPath(designDir));
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed !== "object" || parsed === null) return null;
		const state = parsed as Partial<PeekState>;
		if (!state.sha || !state.returnTo) return null;
		return { sha: state.sha, title: state.title ?? "", returnTo: state.returnTo };
	} catch {
		return null;
	}
}

async function checkout(ctx: PluginContext, designDir: string, sha: string): Promise<void> {
	await runHistoryCommand(ctx, { cmd: "checkout", dir: designDir, sha });
}

/**
 * 进入查看模式。返回 null 表示没进去（历史为空，或者目标就是当前版本）。
 */
export async function enterPeek(
	ctx: PluginContext,
	session: DesignSession,
	target: { sha: string; title: string },
): Promise<PeekState | null> {
	// 未提交的现场先落成版本。这一步不是保险：下一行就要用旧版本覆盖工作区。
	await commitHistory(ctx, session.dirPath, "查看历史前的状态");
	const head = (await listHistory(ctx, session.dirPath, 1))[0];
	if (!head) return null;
	if (head.sha === target.sha) return null;

	const state: PeekState = { sha: target.sha, title: target.title, returnTo: head.sha };
	// 标记先写后切：反过来的话，切完到写标记之间崩溃，就没人知道该退回哪一版了。
	await ctx.fs.writeFile(peekMarkerPath(session.dirPath), `${JSON.stringify(state, null, "\t")}\n`);
	await checkout(ctx, session.dirPath, target.sha);
	await session.reload();
	return state;
}

/**
 * 退出查看模式，写回进入时的那一版。
 *
 * peek 期间对文件的改动会被丢弃——工作区此刻装的是一份旧版本，在它上面改出来的东西
 * 既不属于旧版也不属于新版。所以查看模式下自动提交是关掉的，横幅也写明了。
 */
export async function exitPeek(ctx: PluginContext, session: DesignSession): Promise<boolean> {
	const state = await readPeekState(ctx, session.dirPath);
	if (!state) return false;
	await checkout(ctx, session.dirPath, state.returnTo);
	// 标记后删：删完到写回之间崩溃会留下一个「内容是旧版、却没人知道要退回」的设计。
	await ctx.fs.delete(peekMarkerPath(session.dirPath)).catch(() => {});
	await session.reload();
	return true;
}

/** 只清标记，不动文件。用于「就恢复到这一版」——那一步自己会写工作区。 */
export async function clearPeekMarker(ctx: PluginContext, designDir: string): Promise<void> {
	await ctx.fs.delete(peekMarkerPath(designDir)).catch(() => {});
}
