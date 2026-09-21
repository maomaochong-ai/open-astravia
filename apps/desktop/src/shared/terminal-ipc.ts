/**
 * 底部面板终端的跨进程合同。
 *
 * PTY 的事实源在主进程：进程、缓冲和尺寸都在那边，渲染进程只是一块显示面。
 * 增量输出走**单一** EVENT 频道按 terminalId 多路复用（与 `ipc/session.ts` 的订阅
 * 模式同形），而不是每个终端开一个新 channel 名——后者会随 tab 数量无界增长。
 */

export const TERMINAL_CHANNELS = {
	/** 本机 PTY 是否可用（缺预编译二进制时为否），用于决定终端入口是否出现。 */
	CAPABILITIES: "vetta:terminal:capabilities",
	/** 建终端；返回 terminalId 与订阅前已经产生的输出。 */
	OPEN: "vetta:terminal:open",
	WRITE: "vetta:terminal:write",
	RESIZE: "vetta:terminal:resize",
	CLOSE: "vetta:terminal:close",
	/** 查前台是否还有活进程，关闭确认用。 */
	FOREGROUND: "vetta:terminal:foreground",
	/**
	 * 渲染进程防抖上报 serialize 结果；tabId 为键，跨会话保留。
	 *
	 * 关闭 tab 时不主动删快照：删了之后组件卸载还会补写一次，两者会打架；
	 * 而且那会把终端专属调用塞进通用的关闭路径。留着由总量上限淘汰即可。
	 */
	SNAPSHOT_SAVE: "vetta:terminal:snapshot-save",
	SNAPSHOT_LOAD: "vetta:terminal:snapshot-load",
	/** main → renderer：单一多路复用频道。 */
	EVENT: "vetta:terminal:event",
} as const;

export interface TerminalCapabilities {
	readonly localPty: boolean;
	/** 不可用时的原因，原样展示给用户（多半是缺平台二进制）。 */
	readonly unavailableReason?: string;
}

export interface OpenTerminalRequest {
	/** 本地绝对路径，或 `ssh://<hostId>/<path>`。 */
	readonly cwd: string;
	readonly cols: number;
	readonly rows: number;
}

export interface OpenTerminalResult {
	readonly terminalId: string;
	readonly backend: "local" | "ssh-helper" | "ssh-tty";
	/**
	 * 订阅建立前已经产生的输出。放在 open 的返回值里而不是等第一个事件，
	 * 是为了堵住「进程起得快、订阅慢一拍」时丢开头几行的窗口。
	 */
	readonly replay: string;
	/** replay 之前还有内容被缓冲上限丢掉了，界面应如实提示省略。 */
	readonly replayTruncated: boolean;
	/** 降级路径的能力缺口，如 `ssh -tt` 无法自适应尺寸。 */
	readonly degraded?: TerminalDegradation;
}

export interface TerminalDegradation {
	readonly reason: "helper-unavailable";
	/** 尺寸变化无法传递给远端。 */
	readonly noResize: true;
}

export type TerminalEvent =
	| { readonly kind: "data"; readonly data: string }
	/** 只在忙/闲**跨越**时发，不逐帧广播。 */
	| { readonly kind: "state"; readonly busy: boolean }
	| { readonly kind: "exit"; readonly exitCode: number | null; readonly signal?: number }
	| { readonly kind: "error"; readonly message: string };

export interface TerminalEventEnvelope {
	readonly terminalId: string;
	readonly event: TerminalEvent;
}

/** 渲染进程报上来的尺寸要夹住：xterm 在容器塌成 0 时会算出 0 行。 */
export const TERMINAL_MIN_COLS = 2;
export const TERMINAL_MIN_ROWS = 1;
export const TERMINAL_MAX_COLS = 1000;
export const TERMINAL_MAX_ROWS = 1000;

export function clampTerminalSize(cols: number, rows: number): { cols: number; rows: number } {
	const clamp = (value: number, min: number, max: number) =>
		!Number.isFinite(value) ? min : Math.min(max, Math.max(min, Math.floor(value)));
	return {
		cols: clamp(cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS),
		rows: clamp(rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS),
	};
}
