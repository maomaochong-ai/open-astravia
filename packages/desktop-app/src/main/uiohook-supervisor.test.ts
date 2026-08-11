// UiohookSupervisor 的生命周期测试：看门狗超时杀重拉、重试预算、意外退出重启、
// stop 后在途消息失效。背景：uiohook-napi 启动竞态死锁会冻结宿主子进程且不退出，
// 「启动超时 → kill → 重拉」是本模块存在的理由，必须由测试锁定。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UiohookHostChild } from "./uiohook-supervisor.js";
import { UiohookSupervisor } from "./uiohook-supervisor.js";

vi.mock("./logger.js", () => ({
	getAppLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
	}),
}));

class FakeChild implements UiohookHostChild {
	killed = false;
	private messageListeners: Array<(message: unknown) => void> = [];
	private exitListeners: Array<(code: number) => void> = [];

	on(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): unknown {
		if (event === "message") this.messageListeners.push(listener as (message: unknown) => void);
		else this.exitListeners.push(listener as (code: number) => void);
		return this;
	}

	kill(): boolean {
		this.killed = true;
		return true;
	}

	emitMessage(message: unknown): void {
		for (const listener of this.messageListeners) listener(message);
	}

	emitExit(code: number): void {
		for (const listener of this.exitListeners) listener(code);
	}
}

const START_TIMEOUT_MS = 4000;
const RESTART_DELAY_MS = 500;

function createSupervisor(overrides?: { maxStartAttempts?: number }) {
	const children: FakeChild[] = [];
	const onKeydown = vi.fn();
	const onKeyup = vi.fn();
	const supervisor = new UiohookSupervisor({
		forkChild: () => {
			const child = new FakeChild();
			children.push(child);
			return child;
		},
		onKeydown,
		onKeyup,
		startTimeoutMs: START_TIMEOUT_MS,
		restartDelayMs: RESTART_DELAY_MS,
		maxStartAttempts: overrides?.maxStartAttempts ?? 3,
	});
	return { supervisor, children, onKeydown, onKeyup };
}

beforeEach(() => {
	vi.useFakeTimers();
});

describe("UiohookSupervisor", () => {
	it("启动成功后转发键盘事件", () => {
		const { supervisor, children, onKeydown, onKeyup } = createSupervisor();
		supervisor.ensureRunning();
		expect(children).toHaveLength(1);

		children[0].emitMessage({ type: "started" });
		expect(supervisor.running).toBe(true);

		children[0].emitMessage({ type: "keydown", keycode: 54 });
		children[0].emitMessage({ type: "keyup", keycode: 54 });
		expect(onKeydown).toHaveBeenCalledWith(54);
		expect(onKeyup).toHaveBeenCalledWith(54);
	});

	it("ensureRunning 幂等：启动中/运行中不重复 fork", () => {
		const { supervisor, children } = createSupervisor();
		supervisor.ensureRunning();
		supervisor.ensureRunning();
		expect(children).toHaveLength(1);

		children[0].emitMessage({ type: "started" });
		supervisor.ensureRunning();
		expect(children).toHaveLength(1);
	});

	it("启动超时（死锁场景）：kill 当前子进程并延迟重拉，第二次成功", () => {
		const { supervisor, children } = createSupervisor();
		supervisor.ensureRunning();

		// 子进程冻结：不上报 started。看门狗到期 → kill → 延迟重拉。
		vi.advanceTimersByTime(START_TIMEOUT_MS);
		expect(children[0].killed).toBe(true);
		expect(children).toHaveLength(1);

		vi.advanceTimersByTime(RESTART_DELAY_MS);
		expect(children).toHaveLength(2);

		children[1].emitMessage({ type: "started" });
		expect(supervisor.running).toBe(true);
	});

	it("被 kill 的旧子进程的在途消息按代号失效", () => {
		const { supervisor, children, onKeydown } = createSupervisor();
		supervisor.ensureRunning();
		vi.advanceTimersByTime(START_TIMEOUT_MS + RESTART_DELAY_MS);
		expect(children).toHaveLength(2);

		// 旧子进程死前残留的消息不得影响状态机。
		children[0].emitMessage({ type: "started" });
		children[0].emitMessage({ type: "keydown", keycode: 54 });
		expect(supervisor.running).toBe(false);
		expect(onKeydown).not.toHaveBeenCalled();
	});

	it("重试预算用尽进入 failed，不再 fork；再次 ensureRunning 重新开始", () => {
		const { supervisor, children } = createSupervisor({ maxStartAttempts: 2 });
		supervisor.ensureRunning();
		vi.advanceTimersByTime((START_TIMEOUT_MS + RESTART_DELAY_MS) * 2);
		expect(children).toHaveLength(2);

		// 预算（2 次）用尽：不再产生第三个子进程。
		vi.advanceTimersByTime((START_TIMEOUT_MS + RESTART_DELAY_MS) * 3);
		expect(children).toHaveLength(2);
		expect(supervisor.running).toBe(false);

		supervisor.ensureRunning();
		expect(children).toHaveLength(3);
	});

	it("start-failed 后子进程退出：走重试路径", () => {
		const { supervisor, children } = createSupervisor();
		supervisor.ensureRunning();
		children[0].emitMessage({ type: "start-failed", message: "boom" });
		children[0].emitExit(1);

		vi.advanceTimersByTime(RESTART_DELAY_MS);
		expect(children).toHaveLength(2);
		children[1].emitMessage({ type: "started" });
		expect(supervisor.running).toBe(true);
	});

	it("运行中意外退出：重置预算并延迟重拉", () => {
		const { supervisor, children } = createSupervisor({ maxStartAttempts: 1 });
		supervisor.ensureRunning();
		children[0].emitMessage({ type: "started" });

		children[0].emitExit(1);
		expect(supervisor.running).toBe(false);
		// 预算已被重置（曾成功启动），意外退出后仍可重拉。
		vi.advanceTimersByTime(RESTART_DELAY_MS);
		expect(children).toHaveLength(2);
	});

	it("stop 杀掉子进程，其后在途消息与定时器全部失效", () => {
		const { supervisor, children, onKeydown } = createSupervisor();
		supervisor.ensureRunning();
		children[0].emitMessage({ type: "started" });

		supervisor.stop();
		expect(children[0].killed).toBe(true);
		expect(supervisor.running).toBe(false);

		children[0].emitMessage({ type: "keydown", keycode: 54 });
		expect(onKeydown).not.toHaveBeenCalled();
		// stop 后不得有残留定时器再拉进程。
		vi.advanceTimersByTime(START_TIMEOUT_MS + RESTART_DELAY_MS);
		expect(children).toHaveLength(1);
	});

	it("结构非法的消息被丢弃", () => {
		const { supervisor, children, onKeydown } = createSupervisor();
		supervisor.ensureRunning();
		children[0].emitMessage({ type: "started" });

		children[0].emitMessage(null);
		children[0].emitMessage("keydown");
		children[0].emitMessage({ type: "keydown" });
		children[0].emitMessage({ type: "keydown", keycode: "54" });
		expect(onKeydown).not.toHaveBeenCalled();
		expect(supervisor.running).toBe(true);
	});
});
