import { describe, expect, it, vi } from "vitest";
import type { TerminalEvent } from "../../shared/terminal-ipc.js";
import type { TerminalBackend, TerminalBackendFactory, TerminalExitEvent } from "./terminal-backend.js";
import {
	type RemoteTerminalBackendFactory,
	TerminalOpenError,
	TerminalService,
	type TerminalServiceOptions,
} from "./terminal-service.js";
import { TerminalSession } from "./terminal-session.js";

class FakeBackend implements TerminalBackend {
	readonly written: string[] = [];
	readonly resizes: Array<[number, number]> = [];
	killed = false;
	foreground: string | undefined;

	private dataListeners = new Set<(chunk: string) => void>();
	private exitListeners = new Set<(event: TerminalExitEvent) => void>();

	write(data: string): void {
		this.written.push(data);
	}

	resize(cols: number, rows: number): void {
		this.resizes.push([cols, rows]);
	}

	foregroundProcess(): string | undefined {
		return this.foreground;
	}

	kill(): void {
		this.killed = true;
	}

	onData(listener: (chunk: string) => void): () => void {
		this.dataListeners.add(listener);
		return () => this.dataListeners.delete(listener);
	}

	onExit(listener: (event: TerminalExitEvent) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	emitData(chunk: string): void {
		for (const listener of this.dataListeners) listener(chunk);
	}

	emitExit(event: TerminalExitEvent): void {
		for (const listener of this.exitListeners) listener(event);
	}
}

function factoryFor(backend: TerminalBackend, opened: unknown[] = []): TerminalBackendFactory {
	return {
		async open(options) {
			opened.push(options);
			return backend;
		},
	};
}

function remoteFactory(
	backend: TerminalBackend,
	degraded: boolean,
	opened: unknown[] = [],
): RemoteTerminalBackendFactory {
	return {
		async open(options) {
			opened.push(options);
			return { backend, degraded };
		},
	};
}

/** 远端不可达时的工厂：用来断言「远程 cwd 绝不会落到本地 backend」。 */
function failingRemoteFactory(): RemoteTerminalBackendFactory {
	return {
		async open() {
			throw new Error("ssh unreachable");
		},
	};
}

function service(overrides: TerminalServiceOptions = {}) {
	let counter = 0;
	return new TerminalService({
		localFactory: factoryFor(new FakeBackend()),
		probeLocal: () => ({ available: true }),
		newId: () => `t${++counter}`,
		...overrides,
	});
}

describe("TerminalSession", () => {
	function session(backend: FakeBackend, timers?: { set: typeof setTimeout; clear: typeof clearTimeout }) {
		return new TerminalSession({
			id: "t1",
			backend,
			backendKind: "local",
			setTimeoutFn: timers?.set,
			clearTimeoutFn: timers?.clear,
		});
	}

	it("把输出同时汇进缓冲和订阅者，新订阅者先拿到快照", () => {
		const backend = new FakeBackend();
		const target = session(backend);
		backend.emitData("first\n");

		const seen: TerminalEvent[] = [];
		const unsubscribe = target.subscribe((event) => seen.push(event));
		backend.emitData("second\n");

		expect(target.replay().data).toBe("first\nsecond\n");
		expect(seen).toContainEqual({ kind: "data", data: "second\n" });
		// 订阅之前的输出只从快照里来，不会被重复推一遍。
		expect(seen.filter((event) => event.kind === "data")).toHaveLength(1);
		unsubscribe();
	});

	it("忙/闲只在跨越时发事件，不逐帧广播", () => {
		vi.useFakeTimers();
		const backend = new FakeBackend();
		const target = session(backend);
		const seen: TerminalEvent[] = [];
		target.subscribe((event) => {
			if (event.kind === "state") seen.push(event);
		});

		backend.emitData("a");
		backend.emitData("b");
		backend.emitData("c");
		expect(seen).toEqual([{ kind: "state", busy: true }]);

		vi.advanceTimersByTime(2000);
		expect(seen).toEqual([
			{ kind: "state", busy: true },
			{ kind: "state", busy: false },
		]);
		vi.useRealTimers();
	});

	it("进程退出后不再写入，也不再报忙", () => {
		const backend = new FakeBackend();
		const target = session(backend);
		backend.emitExit({ exitCode: 0 });

		target.write("ls\n");
		target.resize(120, 40);

		expect(target.hasExited).toBe(true);
		expect(target.isBusy).toBe(false);
		expect(backend.written).toEqual([]);
		expect(backend.resizes).toEqual([]);
	});

	it("前台进程问不出来时返回 undefined，而不是拿启动 shell 冒充", () => {
		const backend = new FakeBackend();
		const target = session(backend);

		expect(target.foregroundProcess()).toBeUndefined();

		backend.foreground = "vim";
		expect(target.foregroundProcess()).toBe("vim");
	});

	it("dispose 杀掉进程并解除订阅；已退出的不再 kill", () => {
		const alive = new FakeBackend();
		session(alive).dispose();
		expect(alive.killed).toBe(true);

		const finished = new FakeBackend();
		const target = session(finished);
		finished.emitExit({ exitCode: 0 });
		target.dispose();
		expect(finished.killed).toBe(false);
	});

	it("dispose 幂等", () => {
		const backend = new FakeBackend();
		const target = session(backend);
		target.dispose();
		target.dispose();

		expect(backend.killed).toBe(true);
	});
});

describe("TerminalService", () => {
	it("本地 cwd 用本地 backend，并把解析后的路径传下去", async () => {
		const opened: unknown[] = [];
		const target = service({ localFactory: factoryFor(new FakeBackend(), opened) });

		const result = await target.open(1, { cwd: "/repo", cols: 80, rows: 24 });

		expect(result.backend).toBe("local");
		expect(opened[0]).toMatchObject({ cwd: "/repo", cols: 80, rows: 24 });
	});

	it("尺寸越界时夹回合法区间", async () => {
		const opened: unknown[] = [];
		const target = service({ localFactory: factoryFor(new FakeBackend(), opened) });

		await target.open(1, { cwd: "/repo", cols: 0, rows: 99999 });

		expect(opened[0]).toMatchObject({ cols: 2, rows: 1000 });
	});

	it("远端起不来时报错上抛，绝不退回本机执行", async () => {
		const localOpened: unknown[] = [];
		const target = service({
			localFactory: factoryFor(new FakeBackend(), localOpened),
			remoteFactory: failingRemoteFactory(),
		});

		await expect(target.open(1, { cwd: "ssh://host-1/srv/app", cols: 80, rows: 24 })).rejects.toThrow(/unreachable/);
		// 关键断言：本地 backend 一次都没被碰过（ADR-0124）。
		expect(localOpened).toEqual([]);
	});

	it("远程 cwd 原样交给远端 backend", async () => {
		const opened: unknown[] = [];
		const target = service({ remoteFactory: remoteFactory(new FakeBackend(), false, opened) });

		const result = await target.open(1, { cwd: "ssh://host-1/srv/app", cols: 80, rows: 24 });

		expect(result.backend).toBe("ssh-helper");
		expect(result.degraded).toBeUndefined();
		expect(opened[0]).toMatchObject({ cwd: "ssh://host-1/srv/app" });
	});

	it("helper 不可用时如实上报尺寸不可自适应", async () => {
		const target = service({ remoteFactory: remoteFactory(new FakeBackend(), true) });

		const result = await target.open(1, { cwd: "ssh://host-1/srv/app", cols: 80, rows: 24 });

		expect(result.backend).toBe("ssh-tty");
		expect(result.degraded).toEqual({ reason: "helper-unavailable", noResize: true });
	});

	it("到达上限后拒绝新建，而不是回收别人的进程", async () => {
		const target = service({ maxSessions: 1 });
		await target.open(1, { cwd: "/repo", cols: 80, rows: 24 });

		await expect(target.open(1, { cwd: "/repo", cols: 80, rows: 24 })).rejects.toThrow(TerminalOpenError);
		expect(target.size).toBe(1);
	});

	it("按 owner 整批回收，不碰别的窗口的终端", async () => {
		const target = service();
		const first = await target.open(11, { cwd: "/repo", cols: 80, rows: 24 });
		const second = await target.open(22, { cwd: "/repo", cols: 80, rows: 24 });

		target.disposeOwnedBy(11);

		expect(target.get(first.terminalId)).toBeUndefined();
		expect(target.get(second.terminalId)).toBeDefined();
	});

	it("dispose 未知 id 不抛", () => {
		expect(() => service().dispose("nope")).not.toThrow();
	});

	it("本机缺预编译二进制时如实报告不可用，并带上原因", () => {
		const target = service({ probeLocal: () => ({ available: false, reason: "pty.node not found" }) });

		expect(target.capabilities()).toEqual({ localPty: false, unavailableReason: "pty.node not found" });
	});
});
