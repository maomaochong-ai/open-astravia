// uiohook 宿主 worker 线程的监督器：spawn / 看门狗 / 重试 / terminate。
// 背景见 uiohook-worker.ts 头注释——uiohook-napi 启动竞态死锁只会冻结 worker 线程，
// 这里以「启动超时即终止重拉」兜底，Electron 主线程 UI 永不因此阻塞。
// 不依赖 electron 与 node:worker_threads，宿主创建由调用方注入
// （quickpanel-trigger.ts 注入 new Worker(...) 的适配器），便于用 fake child 做单元测试。

import { getAppLogger } from "./logger.js";
import type { UiohookHostRequest } from "./uiohook-protocol.js";
import { isUiohookHostMessage } from "./uiohook-protocol.js";

const log = getAppLogger("uiohook-supervisor");

/** 宿主句柄的最小结构子集（node:worker_threads 的 Worker 经适配后满足）。 */
export interface UiohookHostChild {
	on(event: "message", listener: (message: unknown) => void): unknown;
	on(event: "exit", listener: (code: number) => void): unknown;
	/** 下发控制消息（目前只有 "stop"）。 */
	postMessage(message: UiohookHostRequest): void;
	kill(): boolean;
}

/** 一次 spawn 的完整句柄：代号 + 退出信号，供优雅停止等待。 */
interface ChildRecord {
	child: UiohookHostChild;
	generation: number;
	exited: Promise<void>;
	resolveExited: () => void;
}

export interface UiohookSupervisorOptions {
	forkChild: () => UiohookHostChild;
	onKeydown: (keycode: number) => void;
	onKeyup: (keycode: number) => void;
	/** worker 上报 "started" 的期限，超时视为命中启动死锁。 */
	startTimeoutMs?: number;
	/** 单轮启动周期内的最大 spawn 次数，用尽后进入 failed 直到下次 ensureRunning。 */
	maxStartAttempts?: number;
	/** 两次 spawn 之间的间隔，同时为意外退出后的重启节流。 */
	restartDelayMs?: number;
	/** 优雅停止（worker 自行 uIOhook.stop() 后退出）的期限，超时才硬 kill。 */
	stopTimeoutMs?: number;
}

const DEFAULT_START_TIMEOUT_MS = 4000;
const DEFAULT_MAX_START_ATTEMPTS = 3;
const DEFAULT_RESTART_DELAY_MS = 500;
const DEFAULT_STOP_TIMEOUT_MS = 1500;

type SupervisorState = "stopped" | "starting" | "running" | "failed";

export class UiohookSupervisor {
	private state: SupervisorState = "stopped";
	private current: ChildRecord | null = null;
	/** 递增代号：terminate 后在途 worker 的 message/exit 一律按代号失效丢弃。 */
	private generation = 0;
	private startAttempts = 0;
	private watchdog: ReturnType<typeof setTimeout> | null = null;
	private restartTimer: ReturnType<typeof setTimeout> | null = null;

	private readonly forkChild: () => UiohookHostChild;
	private readonly onKeydown: (keycode: number) => void;
	private readonly onKeyup: (keycode: number) => void;
	private readonly startTimeoutMs: number;
	private readonly maxStartAttempts: number;
	private readonly restartDelayMs: number;
	private readonly stopTimeoutMs: number;

	constructor(options: UiohookSupervisorOptions) {
		this.forkChild = options.forkChild;
		this.onKeydown = options.onKeydown;
		this.onKeyup = options.onKeyup;
		this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
		this.maxStartAttempts = options.maxStartAttempts ?? DEFAULT_MAX_START_ATTEMPTS;
		this.restartDelayMs = options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
		this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
	}

	/** 幂等：已在启动/运行中则不动；stopped/failed 则开启新一轮启动周期。 */
	ensureRunning(): void {
		if (this.state === "starting" || this.state === "running") return;
		this.startAttempts = 0;
		this.spawn();
	}

	/**
	 * 幂等：先请求 worker 自行 uIOhook.stop() 后退出，超时才硬 kill；随后的在途消息全部失效。
	 *
	 * 必须优雅停止而不能直接 terminate：uiohook-napi 的 env cleanup hook 依赖原生侧
	 * is_worker_running 归零，否则进程退出时会对失效的 CFRunLoopRef 调 hook_stop()，
	 * macOS 上表现为退出即 SIGTRAP「意外退出」（详见 uiohook-protocol.ts）。
	 *
	 * 返回的 Promise 用于退出清理链等待；不关心时机的调用方可以直接忽略。
	 */
	async stop(): Promise<void> {
		this.clearTimers();
		this.generation += 1;
		const record = this.current;
		this.current = null;
		if (this.state !== "stopped") {
			this.state = "stopped";
			log.info("uiohook host stopping");
		}
		if (!record) return;

		try {
			record.child.postMessage({ type: "stop" });
		} catch (err) {
			log.warn("failed to post stop to uiohook host", err);
			this.killChild(record.child);
			return;
		}

		const exitedInTime = await this.raceExit(record.exited);
		if (!exitedInTime) {
			// worker 未在期限内退出（多半命中 uiohook-napi 启动死锁），只能硬 kill；
			// 此时原生 hook 从未真正 enable，env cleanup hook 不会触碰 run loop。
			log.warn("uiohook host graceful stop timed out, killing", { timeoutMs: this.stopTimeoutMs });
			this.killChild(record.child);
			return;
		}
		log.info("uiohook host stopped");
	}

	/** true = 在期限内退出；false = 超时。无论哪种都不会留下悬挂定时器。 */
	private raceExit(exited: Promise<void>): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), this.stopTimeoutMs);
			void exited.then(() => {
				clearTimeout(timer);
				resolve(true);
			});
		});
	}

	get running(): boolean {
		return this.state === "running";
	}

	private spawn(): void {
		this.clearTimers();
		this.startAttempts += 1;
		this.state = "starting";
		const generation = ++this.generation;

		let child: UiohookHostChild;
		try {
			child = this.forkChild();
		} catch (err) {
			log.error("failed to fork uiohook host", err);
			this.scheduleRetryOrFail();
			return;
		}
		let resolveExited: () => void = () => {};
		const exited = new Promise<void>((resolve) => {
			resolveExited = resolve;
		});
		const record: ChildRecord = { child, generation, exited, resolveExited };
		this.current = record;

		child.on("message", (message) => {
			if (generation !== this.generation) return;
			this.handleMessage(message);
		});
		child.on("exit", (code) => {
			// 退出信号先兑现（stop() 在等它），代号失效只影响后续的重启决策。
			record.resolveExited();
			if (generation !== this.generation) return;
			this.handleExit(code);
		});

		this.watchdog = setTimeout(() => {
			if (generation !== this.generation || this.state !== "starting") return;
			log.warn("uiohook host start timed out (疑似 uiohook-napi 启动死锁)，kill 并重试", {
				attempt: this.startAttempts,
				timeoutMs: this.startTimeoutMs,
			});
			this.generation += 1;
			this.current = null;
			this.killChild(child);
			this.scheduleRetryOrFail();
		}, this.startTimeoutMs);
	}

	private handleMessage(message: unknown): void {
		if (!isUiohookHostMessage(message)) return;
		switch (message.type) {
			case "started":
				this.clearWatchdog();
				this.state = "running";
				this.startAttempts = 0;
				log.info("uiohook host started");
				break;
			case "start-failed":
				// worker 随后自行 exit(1)，统一走 handleExit 的重试路径，这里只记录原因。
				log.error("uiohook host reported start failure", { message: message.message });
				break;
			case "keydown":
				this.onKeydown(message.keycode);
				break;
			case "keyup":
				this.onKeyup(message.keycode);
				break;
		}
	}

	private handleExit(code: number): void {
		this.clearTimers();
		this.current = null;
		this.generation += 1;
		if (this.state === "running") {
			// 已成功启动过：重置尝试预算再重拉（restartDelay 兜住 crash loop 频率）。
			log.warn("uiohook host exited unexpectedly, restarting", { code });
			this.startAttempts = 0;
			this.scheduleRetryOrFail();
		} else if (this.state === "starting") {
			this.scheduleRetryOrFail();
		}
	}

	private scheduleRetryOrFail(): void {
		if (this.startAttempts >= this.maxStartAttempts) {
			this.state = "failed";
			log.error("uiohook host failed to start, giving up（全局键盘手势不可用）", {
				attempts: this.startAttempts,
			});
			return;
		}
		this.state = "starting";
		this.restartTimer = setTimeout(() => {
			this.restartTimer = null;
			this.spawn();
		}, this.restartDelayMs);
	}

	private killChild(child: UiohookHostChild): void {
		try {
			child.kill();
		} catch (err) {
			log.warn("failed to kill uiohook host", err);
		}
	}

	private clearWatchdog(): void {
		if (this.watchdog !== null) {
			clearTimeout(this.watchdog);
			this.watchdog = null;
		}
	}

	private clearTimers(): void {
		this.clearWatchdog();
		if (this.restartTimer !== null) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
	}
}
