/**
 * 渲染层 Long Task 探针。
 *
 * 主进程的 `main-loop-lag-probe` 只能看到主线程被同步工作卡住；渲染层的卡顿（长列表
 * 渲染、巨型组件 commit、脚本解析）不会出现在那里。这里用浏览器原生的
 * `PerformanceObserver("longtask")` 观察超过阈值的 long task，把 duration 与
 * `attribution`（哪个脚本 / 容器触发的）记录下来——排查「长会话首屏慢、切会话卡、
 * 点按钮延迟」这类渲染层症状时的第一手证据。
 *
 * 只在开发构建工作（`import.meta.env.DEV`），生产构建零成本；探针自身是浏览器原生
 * 观察者，不额外计时。记录通过宿主通道交主进程写进诊断日志，随「导出诊断包」一起回收。
 */

const DEFAULT_LONG_TASK_THRESHOLD_MS = 50;
/** attribution 容器名里最长的两个 URL 段，够定位「哪个脚本」又不会太长。 */
const MAX_ATTRIBUTION_URL_SEGMENTS = 2;

export interface LongTaskRecord {
	readonly durationMs: number;
	readonly startTimeMs: number;
	readonly attribution?: string;
}

// PerformanceObserver longtask 的 attribution 类型不是 TS lib.dom 的标准成员（随 TS 版本而异），
// 本地定义最小接口，不依赖 TS 版本。实际运行时这些字段可能缺失，所以全部可选。
export interface PerformanceScriptTiming {
	readonly containerType?: string;
	readonly containerName?: string;
	readonly containerSrc?: string;
}

/** longtask entry：duration 之外带可选的 attribution（脚本来源）。 */
export interface PerformanceLongTaskTiming extends PerformanceEntry {
	readonly attribution?: readonly PerformanceScriptTiming[];
}

function summarizeAttribution(attribution: readonly PerformanceScriptTiming[] | undefined): string | undefined {
	if (!attribution || attribution.length === 0) return undefined;
	const first = attribution[0];
	if (!first) return undefined;
	const src = first.containerSrc ? shortenUrl(first.containerSrc) : undefined;
	const parts = [first.containerType, first.containerName, src].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(" → ") : undefined;
}

function shortenUrl(url: string): string {
	try {
		const path = new URL(url).pathname;
		const segments = path.split("/").filter(Boolean);
		return segments.slice(-MAX_ATTRIBUTION_URL_SEGMENTS).join("/") || path;
	} catch {
		return url;
	}
}

export function initializeLongTaskProbe(
	logEvent: (record: LongTaskRecord) => void,
	options?: { readonly thresholdMs?: number },
): () => void {
	if (import.meta.env.PROD) return () => undefined;
	if (typeof PerformanceObserver === "undefined") return () => undefined;

	const threshold = options?.thresholdMs ?? DEFAULT_LONG_TASK_THRESHOLD_MS;
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			const long = entry as PerformanceLongTaskTiming;
			if (long.duration < threshold) continue;
			logEvent({
				durationMs: Math.round(long.duration),
				startTimeMs: Math.round(long.startTime),
				attribution: summarizeAttribution(
					// PerformanceLongTaskTiming.attribution 是只读数组，某些运行时可能没有。
					typeof long.attribution === "undefined" ? undefined : long.attribution,
				),
			});
		}
	});
	observer.observe({ type: "longtask", buffered: true });
	return () => observer.disconnect();
}
