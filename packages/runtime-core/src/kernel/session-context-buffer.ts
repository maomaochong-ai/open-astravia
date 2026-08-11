import type { SessionContextRecord } from "./contracts.js";

/** 产品适配器只能追加上下文，不能读取或清空其他生产者的数据。 */
export interface RuntimeSessionContextAppender {
	append(records: readonly SessionContextRecord[]): void;
}

export interface RuntimeSessionContextBuffer extends RuntimeSessionContextAppender {
	flush(consumer: (records: readonly SessionContextRecord[]) => Promise<void>): Promise<void>;
	clear(): void;
}

/**
 * Session-local 的运行期上下文缓冲。
 *
 * Turn Pipeline 在自己的 Repository 版本序列内消费记录；追加方不能绕过 Pipeline
 * 直接写 Conversation Repository。
 */
export class BufferedRuntimeSessionContext implements RuntimeSessionContextBuffer {
	private readonly records: SessionContextRecord[] = [];

	append(records: readonly SessionContextRecord[]): void {
		this.records.push(...records);
	}

	async flush(consumer: (records: readonly SessionContextRecord[]) => Promise<void>): Promise<void> {
		const count = this.records.length;
		if (count === 0) return;
		const pending = this.records.slice(0, count);
		await consumer(pending);
		this.records.splice(0, count);
	}

	clear(): void {
		this.records.length = 0;
	}
}
