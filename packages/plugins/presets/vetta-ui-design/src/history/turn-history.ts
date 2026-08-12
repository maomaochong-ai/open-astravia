/**
 * 回合结束自动提交（ADR-0069）。
 *
 * 为什么由插件的 hook 做、而不是给 agent 一个「提交」工具：模型会忘。`.notes.json`
 * 的流程已经证明这类「回合末尾必做」的约定要靠 SKILL.md 反复叮嘱才勉强可靠，而漏
 * 一次就是一个版本永久缺失。挂在 hook 上，agent 完全不需要知道 git 存在。
 */
import type { Disposable, PluginContext } from "@vetta-org/plugin-sdk";
import { getCanvasController } from "../canvas/design-runtime";
import { pickDesignPaths } from "../vetd/discover";
import { commitHistory } from "./history-client";
import { captureThumbnails, thumbFrameIds } from "./history-thumbs";
import { carryOverTitle, commitTitleFromPrompt } from "./turn-title";

const SCOPE_USE = ["project", "conversation"] as const;
const AGENT_MODE = ["work"] as const;

/** 每个会话最近一次用户输入，作为该回合的版本标题。 */
const lastPrompt = new Map<string, string>();

/** 这个 cwd 下的设计包。空列表是常态（多数项目里没有设计），此时整条链路不做任何事。 */
async function designsUnder(ctx: PluginContext, cwd: string): Promise<string[]> {
	try {
		return pickDesignPaths(await ctx.fs.listFilesRecursive(cwd)).bundles;
	} catch {
		return [];
	}
}

/** 画布当前打开的这份设计的帧顺序；不是这一份（或没开画布）就没有。 */
function canvasFrameIdsFor(designDir: string): string[] {
	const session = getCanvasController()?.session;
	if (!session || session.dirPath !== designDir) return [];
	return session.manifest.frames.map((frame) => frame.id);
}

/**
 * 给 cwd 下每一份有变更的设计各落一个版本。没有变更的设计不产生空提交，所以
 * 这里可以无脑遍历——判空由 runner 那侧做，且不含变更时只花一次 node 冷启动。
 */
export async function commitTurn(ctx: PluginContext, cwd: string, title: string): Promise<void> {
	for (const designDir of await designsUnder(ctx, cwd)) {
		try {
			const commit = await commitHistory(ctx, designDir, title);
			if (!commit) continue;
			await captureThumbnails(ctx.fs, designDir, commit.sha, thumbFrameIds(commit.files, canvasFrameIdsFor(designDir)));
		} catch (error) {
			// 一份设计提交失败不该连累其它设计，更不该让回合结束报错。
			console.warn("[vetta-ui-design] 设计版本提交失败", designDir, error);
		}
	}
}

/**
 * 注册两个 hook：
 *
 * - `Stop`：回合自然结束，落这一轮的版本。
 * - `UserPromptSubmit`：先封存上一轮遗留的未提交改动，再记下这一句话。被用户按停止
 *   中断的回合不会触发 `Stop`（continuation 通道在 aborted 时直接返回），那一轮的
 *   改动只能在这里接住。
 */
export function registerTurnHistory(ctx: PluginContext): Disposable[] {
	const promptHook = ctx.agent.registerHook({
		id: "vetd-history-prompt",
		eventName: "UserPromptSubmit",
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ session, event }) => {
			await commitTurn(ctx, session.cwd, carryOverTitle(lastPrompt.get(session.id)));
			lastPrompt.set(session.id, event.prompt);
		},
	});
	const stopHook = ctx.agent.registerHook({
		id: "vetd-history-stop",
		eventName: "Stop",
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ session }) => {
			await commitTurn(ctx, session.cwd, commitTitleFromPrompt(lastPrompt.get(session.id)));
		},
	});
	const endHook = ctx.agent.registerHook({
		id: "vetd-history-session-end",
		eventName: "SessionEnd",
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: ({ session }) => {
			lastPrompt.delete(session.id);
		},
	});
	return [promptHook, stopHook, endHook];
}

/** 测试用：清掉会话记忆。 */
export function resetTurnHistory(): void {
	lastPrompt.clear();
}
