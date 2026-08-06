/**
 * 一轮结束后把还没修好的构建错误退回给 agent。
 *
 * 为什么落在轮次结束、而不是写入的那一刻：插件只能**观察**工具调用
 * （conversation 的 tool-call-start / tool-call-end 都是只读事件），改不了 Edit/Write
 * 的返回值，没法在模型写坏文件的同一步把报错塞回去。能自动闭环的入口只剩一个——
 * 轮次结束时主动发一条后续消息。
 *
 * 三个来源合起来看：
 * - **磁盘解析**（check-syntax）是主力。位图态的 frame 没挂 iframe、也就没有 HMR
 *   连接，坏了根本报不出来——这条链路不依赖画布，坏帧躺在哪都抓得到。
 * - **尺寸没声明全**（check-sources 的 frame-size-missing）。这一类最隐蔽：源码在
 *   磁盘上，reconcile 却把它整个跳过，画布上不是「坏帧」而是**什么都没有**。实测
 *   agent 在这种静默下会开始盲改 manifest，而画布已经空了两分多钟。
 * - **HMR 错误**（listFrameErrors）补运行时那一半：语法没问题、渲染时才抛的错。
 *
 * 两道闸避免烦人和死循环：同一条错误只退回一次；同一串错误最多自动退回
 * MAX_AUTO_ROUNDS 轮，之后交回给用户（画布上的「构建失败」徽标一直在）。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { getCanvasController, listFrameErrors } from "../canvas/design-runtime";
import { notify } from "../plugin-context";
import { FRAME_SIZE_RULE } from "./check-sources";
import { SYNTAX_RULE } from "./check-syntax";
import { inspectIssues } from "./inspect";

const MAX_AUTO_ROUNDS = 2;
/**
 * 磁盘解析不需要等任何东西，但 HMR 那一半要：刚写完的文件得等画布的监听把 frame
 * 重新挂上才报得出错。给这条链路一点时间，又不至于把每一轮都拖长。
 */
const SETTLE_MS = 1_500;

/** `file::message` —— 退回过的错误，避免同一条反复打扰。 */
const reported = new Set<string>();
let rounds = 0;
let timer: number | null = null;
/** 递增令牌：flush 是异步的，取消之后在途的那次不能再发出去。 */
let flushToken = 0;

/**
 * `build` —— 文件解析不过 / 运行时抛错，画布停在上一张好图，标题栏挂着失败徽标。
 * `inferredSize` —— 尺寸没声明全，画框按多数派尺寸渲染出来了（frame-size.ts），
 * 但那是猜的。不再是致命错误，仍然值得在轮次结束提一句：一份设计里混着猜出来的
 * 尺寸迟早会咬人，而 agent 自己不会回头查。
 */
type ErrorKind = "build" | "inferredSize";

interface PendingError {
	key: string;
	kind: ErrorKind;
	/** 相对 sidecar 目录的路径，直接拼给模型看。 */
	file: string;
	message: string;
}

function reset(): void {
	reported.clear();
	rounds = 0;
}

export function cancelBuildErrorReport(): void {
	if (timer !== null) {
		window.clearTimeout(timer);
		timer = null;
	}
	flushToken += 1;
	reset();
}

/** 轮次结束时调用。自身发出的那条消息也会走到这里，靠上面两道闸收敛。 */
export function scheduleBuildErrorReport(ctx: PluginContext): void {
	if (timer !== null) window.clearTimeout(timer);
	timer = window.setTimeout(() => {
		timer = null;
		void flush(ctx);
	}, SETTLE_MS);
}

async function collectErrors(ctx: PluginContext, dirPath: string): Promise<PendingError[]> {
	const issues = await inspectIssues(ctx, ctx.fs, dirPath);
	// 只退回硬阻塞。风格违规（hex 颜色、压成一行）随 vetd_screenshot 的 issues 走
	// 就够了，为它们额外发一条后续消息只是打扰。
	const errors: PendingError[] = issues
		.filter((issue) => issue.rule === SYNTAX_RULE || issue.rule === FRAME_SIZE_RULE)
		.map((issue) => ({
			key: `${issue.file}::${issue.line}::${issue.rule}`,
			kind: issue.rule === SYNTAX_RULE ? ("build" as const) : ("inferredSize" as const),
			file: issue.file,
			message: issue.line === null ? issue.message : `${issue.message} (line ${issue.line})`,
		}));
	const knownFiles = new Set(errors.map((error) => error.file));
	for (const [frameId, message] of listFrameErrors()) {
		const file = `frames/${frameId}.tsx`;
		// 同一个文件已经有精确到行的解析错误了，HMR 那条是同一件事的模糊版本。
		if (knownFiles.has(file)) continue;
		errors.push({ key: `${file}::${message}`, kind: "build", file, message });
	}
	return errors;
}

/** 两类失败的原因不同，退回的话术也不能混：一类是「构建挂了」，一类是「压根没上画布」。 */
function buildPrompt(dirPath: string, errors: readonly PendingError[]): string {
	const sections: string[] = [];
	const inferred = errors.filter((error) => error.kind === "inferredSize");
	const broken = errors.filter((error) => error.kind === "build");
	if (inferred.length > 0) {
		sections.push(
			[
				`${inferred.length} frame(s) are on the canvas at a GUESSED size — their source declares no size, so one was inferred from the rest of the design:`,
				"",
				inferred.map((error) => `## ${dirPath}/${error.file}\n\n${error.message}`).join("\n\n"),
				"",
				"Add `export const frame = { width, height, title }` as the first statement of each file, with the size you actually want. Do NOT touch the .vetd manifest — it is generated from these declarations.",
			].join("\n"),
		);
	}
	if (broken.length > 0) {
		sections.push(
			[
				"The design canvas could not build these files, so the frames using them are still showing their previous rendering:",
				"",
				broken.map((error) => `## ${dirPath}/${error.file}\n\n${error.message}`).join("\n\n"),
				"",
				"Edit the broken region — do not rewrite the whole file.",
			].join("\n"),
		);
	}
	sections.push("Then verify with vetd_screenshot.");
	return sections.join("\n\n");
}

async function flush(ctx: PluginContext): Promise<void> {
	const token = flushToken;
	const controller = getCanvasController();
	if (!controller) {
		reset();
		return;
	}
	const errors = await collectErrors(ctx, controller.session.dirPath);
	// 等待解析期间会话可能已经切走 / 被取消。
	if (token !== flushToken || getCanvasController() !== controller) return;
	if (errors.length === 0) {
		// 都修好了：下一次出问题重新从第一轮算起。
		reset();
		return;
	}
	const fresh = errors.filter((error) => !reported.has(error.key));
	if (fresh.length === 0) return;
	if (rounds >= MAX_AUTO_ROUNDS) {
		notify({ message: ctx.i18n.t("canvas.buildError.giveUp"), variant: "warning" });
		return;
	}
	rounds += 1;
	for (const error of fresh) reported.add(error.key);
	void ctx.conversation.sendPrompt(buildPrompt(controller.session.dirPath, fresh)).catch(() => {
		// 会话可能已经切走/正忙，退回失败不值得打扰用户——徽标还在画布上。
	});
}
