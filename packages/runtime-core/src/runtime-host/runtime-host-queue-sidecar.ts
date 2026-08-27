import type { QueueChangedEvent } from "../contracts.js";
import type { RuntimeSessionQueueController } from "./session-ports.js";
import type { RuntimeQueueSidecarStore } from "./session-services.js";

export interface RuntimeHostQueueSidecarOptions {
	readonly store?: RuntimeQueueSidecarStore;
	readonly normalizePath?: (path: string) => string;
	readonly reportFailure?: (error: unknown, sessionId: string) => void;
}

/**
 * RuntimeHost 输入队列快照的唯一持久化协调器。
 *
 * 写操作按规范化 sessionPath 串行，防止较旧快照在较新快照之后落盘。sidecar
 * 损坏或缺失只影响未发送队列，恢复时保持 fail-soft；写失败通过安全观察回调报告。
 */
export class RuntimeHostQueueSidecar {
	private readonly writes = new Map<string, Promise<void>>();
	private readonly store: RuntimeQueueSidecarStore | undefined;
	private readonly normalizePath: (path: string) => string;
	private readonly reportFailure: ((error: unknown, sessionId: string) => void) | undefined;

	constructor(options: RuntimeHostQueueSidecarOptions = {}) {
		this.store = options.store;
		this.normalizePath = options.normalizePath ?? ((path) => path);
		this.reportFailure = options.reportFailure;
	}

	persist(sessionPath: string | undefined, event: QueueChangedEvent): void {
		if (!sessionPath || !this.store) return;
		const key = this.normalizePath(sessionPath);
		const previous = this.writes.get(key) ?? Promise.resolve();
		const next = previous.then(async () => {
			try {
				if (event.entries.length === 0 && !event.paused) {
					await this.store?.remove(sessionPath);
					return;
				}
				await this.store?.write(sessionPath, event.snapshot);
			} catch (error) {
				this.reportFailure?.(error, event.sessionId);
			}
		});
		this.writes.set(key, next);
	}

	async restore(queueController: RuntimeSessionQueueController, sessionPath: string | undefined): Promise<void> {
		if (!sessionPath || !this.store) return;
		try {
			const snapshot = await this.store.read(sessionPath);
			if (snapshot !== undefined) queueController.restoreQueue(snapshot);
		} catch {
			// Missing or damaged sidecars never invalidate durable conversation history.
		}
	}
}
