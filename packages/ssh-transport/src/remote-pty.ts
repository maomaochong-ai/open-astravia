import { quoteShellArgument } from "./remote-command.js";

/**
 * 远端交互式终端。
 *
 * 两条路：装了 helper 就走 `pty.*`（真伪终端、能改尺寸、输出走通知推送）；
 * 没有就退回 `ssh -tt` 起一个登录 shell。降级路径**能用但有缺口**，界面必须如实告知，
 * 不能让用户以为尺寸会自适应（见 {@link RemotePtySession.canResize}）。
 */
export interface RemotePtySession {
	readonly backend: "helper" | "tty";
	/** `false` 表示这条路送不进窗口尺寸变化，界面应提示「尺寸固定」。 */
	readonly canResize: boolean;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	close(): void;
	/** `dropped` 是远端积压超限时丢掉的字节数，大于 0 时调用方应如实提示输出有省略。 */
	onData(listener: (chunk: string, dropped: number) => void): () => void;
	onExit(listener: (event: { readonly exitCode: number | null }) => void): () => void;
}

export interface OpenRemotePtyOptions {
	/** 远端绝对路径。 */
	readonly cwd: string;
	readonly cols: number;
	readonly rows: number;
	readonly shell?: string;
	readonly env?: Readonly<Record<string, string>>;
}

/**
 * `ssh -tt` 降级路径的远端命令。
 *
 * `exec` 换掉外层 sh，SIGHUP 才能直达用户 shell；`-l` 是登录 shell，否则拿不到用户
 * profile 注入的 PATH。尺寸只在开场用 `stty` 设一次：之后再注入 `stty` 会打断用户
 * 正在敲的那一行，代价比「尺寸固定」更糟。
 */
export function buildTtyShellCommand(options: OpenRemotePtyOptions): string {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: 交给远端 shell 展开，不是 JS 模板；在本机展开就成了本机的 SHELL。
	const shell = options.shell ? quoteShellArgument(options.shell) : '"${SHELL:-/bin/sh}"';
	const exports = Object.entries(options.env ?? {})
		.map(([key, value]) => `export ${key}=${quoteShellArgument(value)};`)
		.join(" ");
	return [
		`cd ${quoteShellArgument(options.cwd)}`,
		`stty rows ${Math.trunc(options.rows)} cols ${Math.trunc(options.cols)} 2>/dev/null`,
		`${exports} exec ${shell} -l`,
	].join(" && ");
}

/** helper 的 `pty.data` / `pty.exit` 通知载荷。 */
export interface RemotePtyDataNotification {
	readonly id: string;
	readonly dataB64: string;
	/** 远端积压超限时丢掉的字节数；界面可据此提示输出有省略。 */
	readonly dropped?: number;
}

export interface RemotePtyExitNotification {
	readonly id: string;
	readonly exitCode: number | null;
}

export function isRemotePtyDataNotification(params: unknown): params is RemotePtyDataNotification {
	if (typeof params !== "object" || params === null) return false;
	const candidate = params as Record<string, unknown>;
	return typeof candidate.id === "string" && typeof candidate.dataB64 === "string";
}

export function isRemotePtyExitNotification(params: unknown): params is RemotePtyExitNotification {
	if (typeof params !== "object" || params === null) return false;
	const candidate = params as Record<string, unknown>;
	return typeof candidate.id === "string";
}
