import type { TerminalEvent } from "../../shared/terminal-ipc.js";
import { OutputRingBuffer } from "./output-ring-buffer.js";
import type { TerminalBackend } from "./terminal-backend.js";

/** 尾部缓冲上限：够补上一次切 tab / 展开面板期间的输出，不当历史记录用。 */
const OUTPUT_BUFFER_LIMIT = 256 * 1024;

/** 最近一次输出后多久算回到空闲。太短会让状态点在连续输出里闪烁。 */
const BUSY_IDLE_DELAY_MS = 1500;

export type TerminalEventListener = (event: TerminalEvent) => void;

export interface TerminalSessionOptions {
	readonly id: string;
	readonly backend: TerminalBackend;
	readonly backendKind: "local" | "ssh-helper" | "ssh-tty";
	/** 注入定时器便于测试忙/闲跨越，不用等真实 1.5 秒。 */
	readonly setTimeoutFn?: typeof setTimeout;
	readonly clearTimeoutFn?: typeof clearTimeout;
}

/**
 * 一个终端会话：把 backend 的输出汇到尾部缓冲并广播给订阅者，同时维护忙/闲状态。
 *
 * 订阅者可以来去（面板折叠、切 tab、渲染进程重载），会话本身不随之结束——
 * 结束只由两件事触发：进程自己退出，或调用方显式 dispose。
 */
export class TerminalSession {
	readonly id: string;
	readonly backendKind: "local" | "ssh-helper" | "ssh-tty";

	private readonly backend: TerminalBackend;
	private readonly buffer = new OutputRingBuffer(OUTPUT_BUFFER_LIMIT);
	private readonly listeners = new Set<TerminalEventListener>();
	private readonly disposers: Array<() => void> = [];
	private readonly setTimeoutFn: typeof setTimeout;
	private readonly clearTimeoutFn: typeof clearTimeout;

	private busy = false;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private exited: { exitCode: number | null; signal?: number } | undefined;
	private disposed = false;

	constructor(options: TerminalSessionOptions) {
		this.id = options.id;
		this.backend = options.backend;
		this.backendKind = options.backendKind;
		this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
		this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

		this.disposers.push(
			this.backend.onData((chunk) => {
				this.buffer.push(chunk);
				this.markBusy();
				this.emit({ kind: "data", data: chunk });
			}),
		);
		this.disposers.push(
			this.backend.onExit((event) => {
				this.exited = event;
				this.setBusy(false);
				this.emit({ kind: "exit", exitCode: event.exitCode, signal: event.signal });
			}),
		);
	}

	get hasExited(): boolean {
		return this.exited !== undefined;
	}

	get isBusy(): boolean {
		return this.busy;
	}

	/** 新订阅者先拿到缓冲快照，再接增量。 */
	replay(): { data: string; truncated: boolean } {
		return { data: this.buffer.read(), truncated: this.buffer.isTruncated() };
	}

	subscribe(listener: TerminalEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	write(data: string): void {
		// 进程已经退出后仍然写入会在 node-pty 里抛，这里直接忽略：
		// 用户在已结束的终端里敲键盘不是错误。
		if (this.disposed || this.exited) return;
		this.backend.write(data);
	}

	resize(cols: number, rows: number): void {
		if (this.disposed || this.exited) return;
		this.backend.resize(cols, rows);
	}

	/** 关闭确认用：返回 undefined 表示「问不出来」，不等于「没东西在跑」。 */
	foregroundProcess(): string | undefined {
		if (this.disposed || this.exited) return undefined;
		return this.backend.foregroundProcess();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearIdleTimer();
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		if (!this.exited) {
			try {
				this.backend.kill();
			} catch {
				// 进程可能已经自己走了，kill 失败不影响回收。
			}
		}
		this.listeners.clear();
		this.buffer.clear();
	}

	private emit(event: TerminalEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}

	private markBusy(): void {
		this.setBusy(true);
		this.clearIdleTimer();
		this.idleTimer = this.setTimeoutFn(() => {
			this.idleTimer = undefined;
			this.setBusy(false);
		}, BUSY_IDLE_DELAY_MS);
	}

	private setBusy(next: boolean): void {
		if (this.busy === next) return;
		this.busy = next;
		this.emit({ kind: "state", busy: next });
	}

	private clearIdleTimer(): void {
		if (this.idleTimer === undefined) return;
		this.clearTimeoutFn(this.idleTimer);
		this.idleTimer = undefined;
	}
}
