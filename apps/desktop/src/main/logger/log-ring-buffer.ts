import type { ErrorChainNode } from "./format-error-chain.js";

// 进程内最近 N 条结构化日志环形缓冲。崩溃排错 / 导出诊断包时带出最近上下文，
// 不落盘（决策：NDJSON 仅在导出时序列化，零磁盘 IO 增量）。主进程单线程，无需锁。
export interface RingEntry {
	ts: string;
	level: string;
	scope: string;
	msg: string;
	fields?: Record<string, unknown>;
	error?: ErrorChainNode;
}

class LogRingBuffer {
	private buf: RingEntry[] = [];

	constructor(private readonly capacity: number) {}

	push(entry: RingEntry): void {
		this.buf.push(entry);
		if (this.buf.length > this.capacity) {
			this.buf.splice(0, this.buf.length - this.capacity);
		}
	}

	snapshot(): RingEntry[] {
		return this.buf.slice();
	}

	clear(): void {
		this.buf = [];
	}
}

// 跨 main/render/im 三个 logger 实例共享同一单例：它们都挂同款采集 transport。
export const logRingBuffer = new LogRingBuffer(1000);
