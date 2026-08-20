/**
 * [PERF-session-switch] 已有会话打开链路的本地诊断。
 *
 * 打开方式（Renderer DevTools Console）：
 *   localStorage.setItem("vetta-perf-session-switch", "1"); location.reload()
 * 关闭：localStorage.removeItem("vetta-perf-session-switch")
 *
 * 关闭诊断时只生成 privacy-safe interaction id，用来关联 Main 进程已有的
 * `session creation trace`；不会安装 PerformanceObserver、计时器或输出 Renderer 日志。
 */

const ENABLED_KEY = "vetta-perf-session-switch";
const MAX_REPORT_DELAY_MS = 15_000;
const COMPLETION_REPORT_DELAY_MS = 1_000;
const TRACKED_FRAME_COUNT = 5;
const MAX_REACT_COMMITS = 100;

interface TraceMark {
	label: string;
	at: number;
}

interface ReactCommit {
	id: string;
	phase: "mount" | "update" | "nested-update";
	at: number;
	actualDuration: number;
	baseDuration: number;
}

interface SessionSwitchTrace {
	interactionId: string;
	trigger: string;
	startedAt: number;
	marks: TraceMark[];
	longTasks: Array<{ start: number; duration: number }>;
	reactCommits: ReactCommit[];
	droppedReactCommits: number;
	observer?: PerformanceObserver;
	timer?: number;
	frames: number;
	finishedAt?: number;
}

const traces = new Map<string, SessionSwitchTrace>();
let currentInteractionId: string | null = null;

function isEnabled(): boolean {
	try {
		return window.localStorage.getItem(ENABLED_KEY) === "1";
	} catch {
		return false;
	}
}

function now(): number {
	return performance.now();
}

/** 已有会话打开动作的起点；即使未启用诊断也返回跨进程关联 id。 */
export function perfSessionSwitchBegin(trigger: string): string {
	const interactionId = crypto.randomUUID();
	if (!isEnabled()) return interactionId;

	const started: SessionSwitchTrace = {
		interactionId,
		trigger,
		startedAt: now(),
		marks: [],
		longTasks: [],
		reactCommits: [],
		droppedReactCommits: 0,
		frames: 0,
	};
	traces.set(interactionId, started);
	currentInteractionId = interactionId;

	try {
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				started.longTasks.push({
					start: entry.startTime - started.startedAt,
					duration: entry.duration,
				});
			}
		});
		observer.observe({ entryTypes: ["longtask"] });
		started.observer = observer;
	} catch {
		// Chromium 或测试环境不支持 longtask 时，其余阶段耗时仍然有效。
	}

	const trackFrame = (): void => {
		if (!traces.has(interactionId) || started.frames >= TRACKED_FRAME_COUNT) return;
		started.frames += 1;
		started.marks.push({ label: `frame#${started.frames}`, at: now() });
		requestAnimationFrame(trackFrame);
	};
	requestAnimationFrame(trackFrame);

	started.timer = window.setTimeout(() => report(started, "timeout"), MAX_REPORT_DELAY_MS);
	return interactionId;
}

export function perfSessionSwitchMark(label: string, interactionId?: string): void {
	if (!interactionId) return;
	const trace = traces.get(interactionId);
	if (!trace) return;
	trace.marks.push({ label, at: now() });
}

/** React Profiler sink. No-op unless session-switch diagnostics currently own a trace. */
export function perfSessionSwitchRecordReactCommit(
	id: string,
	phase: "mount" | "update" | "nested-update",
	actualDuration: number,
	baseDuration: number,
): void {
	if (!currentInteractionId) return;
	const trace = traces.get(currentInteractionId);
	if (!trace) return;
	if (trace.reactCommits.length >= MAX_REACT_COMMITS) {
		trace.droppedReactCommits += 1;
		return;
	}
	trace.reactCommits.push({ id, phase, at: now(), actualDuration, baseDuration });
}

export function perfSessionSwitchComplete(status: "completed" | "cancelled" | "failed", interactionId?: string): void {
	if (!interactionId) return;
	const trace = traces.get(interactionId);
	if (!trace) return;
	trace.finishedAt = now();
	trace.marks.push({ label: status, at: trace.finishedAt });
	if (trace.timer) window.clearTimeout(trace.timer);
	trace.timer = window.setTimeout(() => report(trace, status), COMPLETION_REPORT_DELAY_MS);
}

function report(trace: SessionSwitchTrace, status: "completed" | "cancelled" | "failed" | "timeout"): void {
	if (traces.get(trace.interactionId) !== trace) return;
	traces.delete(trace.interactionId);
	if (currentInteractionId === trace.interactionId) currentInteractionId = null;
	trace.observer?.disconnect();
	if (trace.timer) window.clearTimeout(trace.timer);

	const relativeMs = (at: number): number => Math.round(Math.max(0, at - trace.startedAt) * 10) / 10;
	const payload = {
		interactionId: trace.interactionId,
		trigger: trace.trigger,
		status,
		totalDurationMs: relativeMs(trace.finishedAt ?? now()),
		marks: trace.marks.map((mark) => ({ label: mark.label, atMs: relativeMs(mark.at) })),
		longTasks: trace.longTasks.map((task) => ({
			startMs: Math.round(Math.max(0, task.start) * 10) / 10,
			durationMs: Math.round(Math.max(0, task.duration) * 10) / 10,
		})),
		reactCommits: trace.reactCommits.map((commit) => ({
			id: commit.id,
			phase: commit.phase,
			atMs: relativeMs(commit.at),
			actualDurationMs: Math.round(commit.actualDuration * 10) / 10,
			baseDurationMs: Math.round(commit.baseDuration * 10) / 10,
		})),
		droppedReactCommits: trace.droppedReactCommits,
	};

	// 单行 JSON 可以同时被 DevTools、Renderer 文本日志和诊断包稳定检索/解析。
	console.info(`[PERF-session-switch] ${JSON.stringify(payload)}`);
}
