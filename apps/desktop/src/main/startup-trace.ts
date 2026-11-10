/**
 * 启动阶段打点（Windows「启动后桌面无响应 / 闪退」取证用）。
 *
 * 不替代 `installMainDiagnostics()`：那套负责异常与进程生命周期；这里只回答一个问题——
 * 从进程被拉起，到首帧可见、真实内容可见，时间都花在哪一段。
 *
 * 设计约束：
 * - 每次 mark 只写**一行**日志（`[startup] <label> at=<n>ms delta=<n>ms`），
 *   而不是结构化字段。electron-log 会把对象字段序列化成跨多行的 inspect 输出，
 *   用户机器上的日志就再也 grep 不动了。
 * - `sinceProcessStart` 从进程真正启动算起（Electron bootstrap、单实例锁等待都算进去），
 *   否则「窗口很久才出现」的原因会被 JS 入口之后的计时掩盖。
 * - 超过 `slowPhaseMs` 的阶段用 warn，便于直接从日志筛出可疑段。
 */

/** 单阶段超过这个时长就升级为 warn；普通阶段只是 info。 */
export const STARTUP_SLOW_PHASE_MS = 1_500;

const MAX_TRACKED_MARKS = 64;

export interface StartupMark {
	readonly label: string;
	/** 相对进程启动的毫秒数。 */
	readonly atMs: number;
	/** 相对上一个 mark 的毫秒数；第一个 mark 为相对进程启动。 */
	readonly sincePreviousMs: number;
	readonly slow: boolean;
}

export interface StartupTraceLogger {
	info(message: string): void;
	warn(message: string): void;
}

export interface StartupTraceOptions {
	readonly log: StartupTraceLogger;
	/** 当前时间（epoch ms），测试注入。 */
	readonly now?: () => number;
	/** 进程启动时刻（epoch ms），缺省用 `now() - process.uptime()*1000`。 */
	readonly originAt?: number;
	readonly slowPhaseMs?: number;
}

export interface StartupTrace {
	mark(label: string): StartupMark;
	/** 已记录阶段的只读快照，供诊断包导出。 */
	snapshot(): readonly StartupMark[];
}

/**
 * 模块级快照：诊断包在另一个模块里被调用，拿不到 main.ts 里的实例；
 * 用一份进程级的最近记录最省事，也正好只保留「本次启动」的时间线。
 */
let latestSnapshot: readonly StartupMark[] = [];

export function startupTraceSnapshot(): readonly StartupMark[] {
	return latestSnapshot;
}

export function createStartupTrace(options: StartupTraceOptions): StartupTrace {
	const now = options.now ?? Date.now;
	const originAt = options.originAt ?? now() - Math.round(process.uptime() * 1000);
	const slowPhaseMs = options.slowPhaseMs ?? STARTUP_SLOW_PHASE_MS;
	const marks: StartupMark[] = [];

	let lastAt = originAt;
	const trace: StartupTrace = {
		mark(label: string): StartupMark {
			const at = now();
			const sincePreviousMs = round(Math.max(0, at - lastAt));
			lastAt = at;
			const mark: StartupMark = {
				label,
				atMs: round(Math.max(0, at - originAt)),
				sincePreviousMs,
				slow: sincePreviousMs >= slowPhaseMs,
			};
			if (marks.length < MAX_TRACKED_MARKS) marks.push(mark);
			latestSnapshot = [...marks];
			const line = `[startup] ${label} at=${mark.atMs}ms delta=${sincePreviousMs}ms`;
			try {
				if (mark.slow) options.log.warn(line);
				else options.log.info(line);
			} catch {
				// 打点绝不能改变启动行为。
			}
			return mark;
		},
		snapshot(): readonly StartupMark[] {
			return [...marks];
		},
	};
	return trace;
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}
