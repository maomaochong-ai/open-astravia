/**
 * 一轮结束后把还没修好的构建错误退回给 agent。
 *
 * 为什么落在轮次结束、而不是写入的那一刻：插件只能**观察**工具调用
 * （conversation 的 tool-call-start / tool-call-end 都是只读事件），改不了 Edit/Write
 * 的返回值，没法在模型写坏文件的同一步把报错塞回去。能自动闭环的入口只剩一个——
 * 轮次结束时主动发一条后续消息。
 *
 * 两道闸避免烦人和死循环：同一条错误只退回一次；同一串错误最多自动退回
 * MAX_AUTO_ROUNDS 轮，之后交回给用户（画布上的「构建失败」徽标一直在）。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { getCanvasController, listFrameErrors } from "../canvas/design-runtime";
import { notify } from "../plugin-context";

const MAX_AUTO_ROUNDS = 2;
/**
 * 位图态的 frame 没有 iframe、也就没有 HMR 连接，错误要等画布的文件监听把它重新
 * 挂上才报得出来。轮次刚结束时问往往还是「一切正常」，先给这条链路一点时间。
 */
const SETTLE_MS = 3_000;

/** `frameId::message` —— 退回过的错误，避免同一条反复打扰。 */
const reported = new Set<string>();
let rounds = 0;
let timer: number | null = null;

function reset(): void {
	reported.clear();
	rounds = 0;
}

export function cancelBuildErrorReport(): void {
	if (timer !== null) {
		window.clearTimeout(timer);
		timer = null;
	}
	reset();
}

/** 轮次结束时调用。自身发出的那条消息也会走到这里，靠上面两道闸收敛。 */
export function scheduleBuildErrorReport(ctx: PluginContext): void {
	if (timer !== null) window.clearTimeout(timer);
	timer = window.setTimeout(() => {
		timer = null;
		flush(ctx);
	}, SETTLE_MS);
}

function flush(ctx: PluginContext): void {
	const controller = getCanvasController();
	const errors = [...listFrameErrors()];
	if (!controller || errors.length === 0) {
		// 都修好了（或画布关了）：下一次出问题重新从第一轮算起。
		reset();
		return;
	}
	const fresh = errors.filter(([frameId, message]) => !reported.has(`${frameId}::${message}`));
	if (fresh.length === 0) return;
	if (rounds >= MAX_AUTO_ROUNDS) {
		notify({ message: ctx.i18n.t("canvas.buildError.giveUp"), variant: "warning" });
		return;
	}
	rounds += 1;
	for (const [frameId, message] of fresh) reported.add(`${frameId}::${message}`);
	const detail = fresh
		.map(([frameId, message]) => `## ${controller.session.dirPath}/frames/${frameId}.tsx\n\n${message}`)
		.join("\n\n");
	const prompt = [
		"The design canvas could not build these frames, so they are still showing their previous rendering:",
		"",
		detail,
		"",
		"Fix the source files, then verify with vetd_screenshot.",
	].join("\n");
	void ctx.conversation.sendPrompt(prompt).catch(() => {
		// 会话可能已经切走/正忙，退回失败不值得打扰用户——徽标还在画布上。
	});
}
