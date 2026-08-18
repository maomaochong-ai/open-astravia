// uiohook 宿主子进程的监督器：spawn / 看门狗 / 重试 / kill。
// 背景见 uiohook-host.ts 头注释——uiohook-napi 启动竞态死锁只会冻结子进程，
// 这里以「启动超时即杀掉重拉」兜底，主进程 UI 永不因此阻塞。
// 不依赖 electron，fork 实现由调用方注入（quickpanel-trigger.ts 注入 utilityProcess.fork），
// 便于用 fake child 做单元测试。

import { getAppLogger } from "./logger.js";
import { isUiohookHostMessage } from "./uiohook-protocol.js";

const log = getAppLogger("uiohook-supervisor");

/** utilityProcess 的最小结构子集（Electron.UtilityProcess 满足）。 */
export interface UiohookHostChild {
	on(event: "message", listener: (message: unknown) => void): unknown;
	on(event: "exit", listener: (code: number) => void): unknown;
	kill(): boolean;
}

export interface UiohookSupervisorOptions {
	forkChild: () => UiohookHostChild;
	onKeydown: (keycode: number) => void;
	onKeyup: (keycode: number) => void;
	/** 子进程上报 "started" 的期限，超时视为命中启动死锁。 */
	startTimeoutMs?: number;
	/** 单轮启动周期内的最大 spawn 次数，用尽后进入 failed 直到下次 ensureRunning。 */
	maxStartAttempts?: number;
	/** 两次 spawn 之间的间隔，同时为意外退出后的重启节流。 */
	restartDelayMs?: number;
}

const DEFAULT_START_TIMEOUT_MS = 4000;
const DEFAULT_MAX_START_ATTEMPTS = 3;
const DEFAULT_RESTART_DELAY_MS = 500;

type SupervisorState = "stopped" | "starting" | "running" | "failed";

export class UiohookSupervisor {
	private state: SupervisorState = "stopped";
	private child: UiohookHostChild | null = null;
	/** 递增代号：kill 后在途子进程的 message/exit 一律按代号失效丢弃。 */
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

	constructor(options: UiohookSupervisorOptions) {
		this.forkChild = options.forkChild;
		this.onKeydown = options.onKeydown;
		this.onKeyup = options.onKeyup;
		this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
		this.maxStartAttempts = options.maxStartAttempts ?? DEFAULT_MAX_START_ATTEMPTS;
		this.restartDelayMs = options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
	}

	/** 幂等：已在启动/运行中则不动；stopped/failed 则开启新一轮启动周期。 */
	ensureRunning(): void {
		if (this.state === "starting" || this.state === "running") return;
		this.startAttempts = 0;
		this.spawn();
	}

	/** 幂等：杀掉子进程并清空定时器，随后的在途消息全部失效。 */
	stop(): void {
		this.clearTimers();
		this.generation += 1;
		this.killChild();
		if (this.state !== "stopped") {
			this.state = "stopped";
			log.info("uiohook host stopped");
		}
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
		this.child = child;

		child.on("message", (message) => {
			if (generation !== this.generation) return;
			this.handleMessage(message);
		});
		child.on("exit", (code) => {
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
			this.killChild();
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
				// 子进程随后自行 exit(1)，统一走 handleExit 的重试路径，这里只记录原因。
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
		this.child = null;
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

	private killChild(): void {
		if (!this.child) return;
		try {
			this.child.kill();
		} catch (err) {
			log.warn("failed to kill uiohook host", err);
		}
		this.child = null;
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
