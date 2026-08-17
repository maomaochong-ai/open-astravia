/**
 * [PERF-send] 临时插桩：定位「点击发送 / 回车后界面冻结」的耗时归属。
 *
 * 打开方式（渲染进程 DevTools Console）：
 *   localStorage.setItem("vetta-perf-send", "1"); location.reload()
 * 关闭：localStorage.removeItem("vetta-perf-send")
 *
 * 诊断结束后整个文件连同调用点一起删除。
 */

import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";

const ENABLED_KEY = "vetta-perf-send";
const REPORT_DELAY_MS = 3000;

let enabledCache: boolean | null = null;

export function perfSendEnabled(): boolean {
	if (enabledCache === null) {
		try {
			enabledCache = window.localStorage.getItem(ENABLED_KEY) === "1";
		} catch {
			enabledCache = false;
		}
	}
	return enabledCache;
}

interface Commit {
	id: string;
	phase: string;
	actual: number;
	base: number;
	at: number;
}

interface Session {
	t0: number;
	trigger: string;
	marks: Array<{ label: string; at: number }>;
	commits: Commit[];
	longTasks: Array<{ start: number; duration: number }>;
	observer?: PerformanceObserver;
	timer?: number;
	frames: number;
}

let session: Session | null = null;

function now(): number {
	return performance.now();
}

/** 发送动作起点：按钮 click / 编辑器 Enter。 */
export function perfSendBegin(trigger: string): void {
	if (!perfSendEnabled()) return;
	if (session?.timer) window.clearTimeout(session.timer);
	session?.observer?.disconnect();

	const started: Session = {
		t0: now(),
		trigger,
		marks: [],
		commits: [],
		longTasks: [],
		frames: 0,
	};
	session = started;

	try {
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				started.longTasks.push({ start: entry.startTime - started.t0, duration: entry.duration });
			}
		});
		observer.observe({ entryTypes: ["longtask"] });
		started.observer = observer;
	} catch {
		// longtask 不可用时其余指标仍有效。
	}

	// 前 5 帧的到达时间：第一帧比同步段晚多少，就是用户看到「界面冻住」的时长。
	const trackFrame = (): void => {
		if (session !== started || started.frames >= 5) return;
		started.frames++;
		started.marks.push({ label: `frame#${started.frames}`, at: now() });
		requestAnimationFrame(trackFrame);
	};
	requestAnimationFrame(trackFrame);

	started.timer = window.setTimeout(() => report(started), REPORT_DELAY_MS);
}

/** 发送链路上的阶段点。 */
export function perfSendMark(label: string): void {
	if (!session || !perfSendEnabled()) return;
	session.marks.push({ label, at: now() });
}

export const perfSendProfilerCallback: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
	if (!session) return;
	session.commits.push({ id, phase, actual: actualDuration, base: baseDuration, at: now() });
};

/** 只在插桩开启时套一层 Profiler，关闭时零开销直通。 */
export function PerfSendProfiler({ id, children }: { id: string; children: ReactNode }): JSX.Element {
	if (!perfSendEnabled()) return <>{children}</>;
	return (
		<Profiler id={id} onRender={perfSendProfilerCallback}>
			{children}
		</Profiler>
	);
}

function report(target: Session): void {
	if (session !== target) return;
	target.observer?.disconnect();
	const rel = (at: number): string => `${(at - target.t0).toFixed(1)}ms`;

	const commitTotals = new Map<string, { count: number; actual: number }>();
	for (const commit of target.commits) {
		const entry = commitTotals.get(commit.id) ?? { count: 0, actual: 0 };
		entry.count++;
		entry.actual += commit.actual;
		commitTotals.set(commit.id, entry);
	}

	console.group(`[PERF-send] trigger=${target.trigger}`);
	console.log(
		"marks:",
		target.marks.map((mark) => `${mark.label}@${rel(mark.at)}`).join("  "),
	);
	console.log(
		"commits:",
		[...commitTotals.entries()]
			.map(([id, entry]) => `${id} x${entry.count} = ${entry.actual.toFixed(1)}ms`)
			.join("  |  "),
	);
	console.table(
		target.commits.map((commit) => ({
			id: commit.id,
			phase: commit.phase,
			actual: Number(commit.actual.toFixed(1)),
			base: Number(commit.base.toFixed(1)),
			at: Number((commit.at - target.t0).toFixed(1)),
		})),
	);
	console.log(
		"longTasks:",
		target.longTasks.map((task) => `${task.duration.toFixed(0)}ms@${task.start.toFixed(0)}`).join("  "),
	);
	console.groupEnd();
	session = null;
}
