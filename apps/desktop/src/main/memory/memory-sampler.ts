/**
 * 主进程与各 Electron 进程的内存（工作集）采样器。
 *
 * 「用久了占 30 GB、点哪都卡甚至闪退」这类问题，单看 V8 老生代（`--max-old-space-size`）
 * 看不到全貌：RSS 膨胀来自原生内存、GPU 纹理、Buffer 以及多个 renderer / GPU / utility
 * 进程各自的工作集。这里用 `app.getAppMetrics()` 低频采样各进程的工作集，把「内存随时间
 * 涨到哪去了」变成可导出、可分进程归因的证据。
 *
 * 只在开发构建或显式开启时工作；采样自身是每几十秒一次遍历进程表，成本可忽略，且
 * `unref` 保证不拖住进程退出。
 */
import { app } from "electron";

export interface MemorySampleProcess {
	readonly type: string;
	readonly workingSetMb: number;
	readonly peakWorkingSetMb: number;
}

export interface MemorySample {
	/** 采样时刻（epoch ms）。 */
	readonly atMs: number;
	readonly totalWorkingSetMb: number;
	readonly totalPeakWorkingSetMb: number;
	readonly mainHeapMb: number;
	readonly processes: readonly MemorySampleProcess[];
}

export interface MemorySamplerLogger {
	warn(message: string): void;
}

/** 进程指标的最小视图：只保留采样需要的工作集字段，隔离 electron 具体类型。 */
export interface ProcessMetricLike {
	readonly type: string;
	readonly memory: { readonly workingSetSize: number; readonly peakWorkingSetSize: number };
}

export interface MemorySamplerOptions {
	/** 周期采样间隔；缺省 30s。 */
	readonly intervalMs?: number;
	/** 总工作集超过该值（MB）时记一条告警。缺省 8192（8 GB）。 */
	readonly warnThresholdMb?: number;
	readonly log: MemorySamplerLogger;
	/** 进程内存指标来源；缺省 `app.getAppMetrics()`。测试注入。 */
	readonly getMetrics?: () => ProcessMetricLike[];
	/** 主进程 V8 heap 字节；缺省 `process.memoryUsage().heapUsed`。测试注入。 */
	readonly readMainHeapBytes?: () => number;
	readonly now?: () => number;
}

export interface MemorySampler {
	/** 立即采样一次并记录快照。 */
	sample(): MemorySample;
	stop(): void;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_WARN_THRESHOLD_MB = 8_192;
const MAX_TRACKED_SAMPLES = 64;
const KB = 1024;
const MB = 1024 * 1024;

/** 模块级快照：诊断包在另一个模块里被调用，拿不到 main.ts 里的实例。 */
let latestSnapshot: readonly MemorySample[] = [];

export function memorySamplerSnapshot(): readonly MemorySample[] {
	return latestSnapshot;
}

export function createMemorySampler(options: MemorySamplerOptions): MemorySampler {
	const now = options.now ?? Date.now;
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
	const warnThresholdMb = options.warnThresholdMb ?? DEFAULT_WARN_THRESHOLD_MB;
	const getMetrics = options.getMetrics ?? (() => app.getAppMetrics());
	const readMainHeapBytes = options.readMainHeapBytes ?? (() => process.memoryUsage().heapUsed);

	const sample = (): MemorySample => {
		const metrics = getMetrics();
		const processes: MemorySampleProcess[] = metrics.map((metric) => ({
			type: metric.type,
			workingSetMb: Math.round(metric.memory.workingSetSize / KB),
			peakWorkingSetMb: Math.round(metric.memory.peakWorkingSetSize / KB),
		}));
		const totalWorkingSetMb = processes.reduce((sum, process) => sum + process.workingSetMb, 0);
		const totalPeakWorkingSetMb = processes.reduce((sum, process) => sum + process.peakWorkingSetMb, 0);
		const record: MemorySample = {
			atMs: now(),
			totalWorkingSetMb,
			totalPeakWorkingSetMb,
			mainHeapMb: Math.round(readMainHeapBytes() / MB),
			processes,
		};
		latestSnapshot = [...latestSnapshot, record].slice(-MAX_TRACKED_SAMPLES);
		if (totalWorkingSetMb >= warnThresholdMb) {
			options.log.warn(
				`[memory] total working set ${totalWorkingSetMb} MB >= ${warnThresholdMb} MB (${processes.length} processes)`,
			);
		}
		return record;
	};

	const timer = setInterval(sample, intervalMs);
	timer.unref?.();

	return {
		sample,
		stop(): void {
			clearInterval(timer);
		},
	};
}
