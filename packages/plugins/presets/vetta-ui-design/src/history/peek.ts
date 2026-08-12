/**
 * 临时查看旧版本（ADR-0069）。
 *
 * peek 与 restore 的区别只有一处：peek **不提交**。旧版本的内容被写进工作区，画布照常
 * 热重载，于是看到的是真实、可交互、可翻页的那一版；退出时用 HEAD 覆盖回去，历史里
 * 不留痕迹。
 *
 * 「不提交」是它全部风险的来源，所以有四道闸：
 * 1. 已经在查看态时不再封存现场——工作区此刻装的是旧版本，再封存就是把旧内容当成
 *    新版本记下来（实测踩过：连点五次「查看」，历史里多出五个一模一样的假版本）。
 * 2. 真正的源码改动才封存成版本；只有 design.json 变了（用户拖了下画框、平移了视口）
 *    时改为把它的内容随标记存下来，退出时写回——否则每次查看都在历史里多一条噪音。
 * 3. 查看期间禁止自动提交（见 turn-history）。
 * 4. 标记留在磁盘上，崩溃或强退后下次打开设计自动退回最新版。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { MANIFEST_FILE } from "../vetd/manifest-types";
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
	/** 退出时要写回的版本——进入查看态那一刻的 HEAD。 */
	returnTo: string;
	/**
	 * 进入时未提交的 design.json 内容（画框位置、视口）。
	 *
	 * 它几乎总是「脏」的，为它落一个版本纯属噪音；但直接丢掉又会让用户拖过的画框在
	 * 退出后弹回去。所以原样存在这里，退出时写回。
	 */
	manifest?: string;
}

export async function readPeekState(ctx: PluginContext, designDir: string): Promise<PeekState | null> {
	try {
		const { content } = await ctx.fs.readFile(peekMarkerPath(designDir));
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed !== "object" || parsed === null) return null;
		const state = parsed as Partial<PeekState>;
		if (!state.sha || !state.returnTo) return null;
		return { sha: state.sha, title: state.title ?? "", returnTo: state.returnTo, manifest: state.manifest };
	} catch {
		return null;
	}
}

async function checkout(ctx: PluginContext, designDir: string, sha: string): Promise<void> {
	await runHistoryCommand(ctx, { cmd: "checkout", dir: designDir, sha });
}

/** 未提交的改动清单（只读，不产生版本）。 */
async function pendingChanges(ctx: PluginContext, designDir: string): Promise<string[]> {
	const { changed } = await runHistoryCommand<{ changed: string[] }>(ctx, { cmd: "status", dir: designDir });
	return changed;
}

async function writeMarker(ctx: PluginContext, designDir: string, state: PeekState): Promise<void> {
	await ctx.fs.writeFile(peekMarkerPath(designDir), `${JSON.stringify(state, null, "\t")}\n`);
}

/**
 * 进入或切换查看的版本。返回 null 表示没进去（历史为空，或者目标就是当前版本）。
 */
export async function enterPeek(
	ctx: PluginContext,
	session: DesignSession,
	target: { sha: string; title: string },
): Promise<PeekState | null> {
	const active = await readPeekState(ctx, session.dirPath);
	if (active) {
		// 已经在查看态：换一版看就好，绝不能再「封存现场」——现场装的是上一版旧内容。
		// returnTo 与 manifest 一路沿用最初进入时的那份。
		if (active.sha === target.sha) return active;
		const next: PeekState = { ...active, sha: target.sha, title: target.title };
		await writeMarker(ctx, session.dirPath, next);
		await checkout(ctx, session.dirPath, target.sha);
		await session.reload();
		return next;
	}

	const changed = await pendingChanges(ctx, session.dirPath);
	// design.json 之外还有东西没提交，才值得落一个版本——那是真的会被覆盖掉的工作。
	const needsCommit = changed.some((file) => file !== MANIFEST_FILE);
	if (needsCommit) await commitHistory(ctx, session.dirPath, "查看历史前的状态");
	const manifest = changed.includes(MANIFEST_FILE)
		? await ctx.fs
				.readFile(`${session.dirPath}/${MANIFEST_FILE}`)
				.then((file) => file.content)
				.catch(() => undefined)
		: undefined;

	const head = (await listHistory(ctx, session.dirPath, 1))[0];
	if (!head) return null;
	if (head.sha === target.sha) return null;

	const state: PeekState = { sha: target.sha, title: target.title, returnTo: head.sha, manifest };
	// 标记先写后切：反过来的话，切完到写标记之间崩溃，就没人知道该退回哪一版了。
	await writeMarker(ctx, session.dirPath, state);
	await checkout(ctx, session.dirPath, target.sha);
	await session.reload();
	return state;
}

/**
 * 退出查看模式，写回进入时的那一版。
 *
 * 查看期间对文件的改动会被丢弃——工作区此刻装的是一份旧版本，在它上面改出来的东西
 * 既不属于旧版也不属于新版。所以查看模式下自动提交是关掉的，横幅也写明了。
 */
export async function exitPeek(ctx: PluginContext, session: DesignSession): Promise<boolean> {
	const state = await readPeekState(ctx, session.dirPath);
	if (!state) return false;
	await checkout(ctx, session.dirPath, state.returnTo);
	// 进入时没提交的画框位置写回去，否则用户拖过的画框在退出后弹回旧位置。
	if (state.manifest !== undefined) {
		await ctx.fs.writeFile(`${session.dirPath}/${MANIFEST_FILE}`, state.manifest).catch(() => {});
	}
	// 标记后删：删完到写回之间崩溃会留下一个「内容是旧版、却没人知道要退回」的设计。
	await ctx.fs.delete(peekMarkerPath(session.dirPath)).catch(() => {});
	await session.reload();
	return true;
}

/** 只清标记，不动文件。用于「就恢复到这一版」——那一步自己会写工作区。 */
export async function clearPeekMarker(ctx: PluginContext, designDir: string): Promise<void> {
	await ctx.fs.delete(peekMarkerPath(designDir)).catch(() => {});
}
