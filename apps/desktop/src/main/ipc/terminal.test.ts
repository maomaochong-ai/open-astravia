import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removeHandler: vi.fn(),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
		removeHandler: mocks.removeHandler,
	},
}));

import { TERMINAL_CHANNELS, type TerminalEvent, type TerminalEventEnvelope } from "../../shared/terminal-ipc.js";
import type { TerminalService } from "../terminal/terminal-service.js";
import { registerTerminalIpc, setTerminalServiceForTests } from "./terminal.js";

interface FakeSender {
	readonly id: number;
	readonly sent: TerminalEventEnvelope[];
	isDestroyed(): boolean;
	once(event: string, listener: () => void): void;
	send(channel: string, envelope: TerminalEventEnvelope): void;
	destroy(): void;
}

function fakeSender(id = 1): FakeSender {
	const listeners = new Map<string, Array<() => void>>();
	let destroyed = false;
	return {
		id,
		sent: [],
		isDestroyed: () => destroyed,
		once(event, listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
		},
		send(_channel, envelope) {
			this.sent.push(envelope);
		},
		destroy() {
			destroyed = true;
			for (const listener of listeners.get("destroyed") ?? []) listener();
		},
	};
}

function fakeSession() {
	const subscribers = new Set<(event: TerminalEvent) => void>();
	return {
		subscribers,
		written: [] as string[],
		resizes: [] as Array<[number, number]>,
		foreground: null as string | null,
		subscribe(listener: (event: TerminalEvent) => void) {
			subscribers.add(listener);
			return () => subscribers.delete(listener);
		},
		write(data: string) {
			this.written.push(data);
		},
		resize(cols: number, rows: number) {
			this.resizes.push([cols, rows]);
		},
		foregroundProcess() {
			return this.foreground ?? undefined;
		},
		emit(event: TerminalEvent) {
			for (const listener of subscribers) listener(event);
		},
	};
}

function fakeService(session: ReturnType<typeof fakeSession>) {
	return {
		opened: [] as unknown[],
		disposed: [] as string[],
		disposedOwners: [] as number[],
		disposeAllCalls: 0,
		capabilities: () => ({ localPty: true }),
		async open(ownerId: number, request: unknown) {
			this.opened.push({ ownerId, request });
			return { terminalId: "t1", backend: "local" as const, replay: "boot\n", replayTruncated: false };
		},
		get: () => session,
		dispose(terminalId: string) {
			this.disposed.push(terminalId);
		},
		disposeOwnedBy(ownerId: number) {
			this.disposedOwners.push(ownerId);
		},
		disposeAll() {
			this.disposeAllCalls += 1;
		},
	};
}

function invoke(channel: string, sender: FakeSender, ...args: unknown[]): unknown {
	const handler = mocks.handlers.get(channel);
	if (!handler) throw new Error(`no handler for ${channel}`);
	return handler({ sender }, ...args);
}

let session: ReturnType<typeof fakeSession>;
let service: ReturnType<typeof fakeService>;
let teardown: () => void;

beforeEach(() => {
	mocks.handlers.clear();
	mocks.removeHandler.mockClear();
	session = fakeSession();
	service = fakeService(session);
	setTerminalServiceForTests(service as unknown as TerminalService);
	teardown = registerTerminalIpc();
});

describe("terminal ipc 合同", () => {
	it("注册除 EVENT 之外的全部 channel（EVENT 是 main→renderer 推送）", () => {
		const registered = [...mocks.handlers.keys()].sort();
		const expected = Object.values(TERMINAL_CHANNELS)
			.filter((channel) => channel !== TERMINAL_CHANNELS.EVENT)
			.sort();

		expect(registered).toEqual(expected);
	});

	it("open 返回订阅前的输出，随后增量走单一 EVENT 频道", async () => {
		const sender = fakeSender();
		const result = await invoke(TERMINAL_CHANNELS.OPEN, sender, { cwd: "/repo", cols: 80, rows: 24 });

		expect(result).toMatchObject({ terminalId: "t1", replay: "boot\n" });
		session.emit({ kind: "data", data: "later\n" });
		expect(sender.sent).toEqual([{ terminalId: "t1", event: { kind: "data", data: "later\n" } }]);
	});

	it("渲染帧销毁后不再往里灌数据，并整批回收该 owner 的终端", async () => {
		const sender = fakeSender(7);
		await invoke(TERMINAL_CHANNELS.OPEN, sender, { cwd: "/repo", cols: 80, rows: 24 });

		sender.destroy();
		session.emit({ kind: "data", data: "after destroy" });

		expect(sender.sent).toEqual([]);
		expect(service.disposedOwners).toContain(7);
	});

	it("拒绝坏参数：cwd 必须非空字符串，write 必须是字符串", async () => {
		const sender = fakeSender();

		await expect(Promise.resolve(invoke(TERMINAL_CHANNELS.OPEN, sender, { cols: 80, rows: 24 }))).rejects.toThrow(
			/cwd/,
		);
		expect(() => invoke(TERMINAL_CHANNELS.WRITE, sender, "t1", 42)).toThrow(/string/);
		expect(() => invoke(TERMINAL_CHANNELS.WRITE, sender, "", "ls")).toThrow(/terminalId/);
	});

	it("open 与 resize 都把越界尺寸夹回合法区间", async () => {
		const sender = fakeSender();
		await invoke(TERMINAL_CHANNELS.OPEN, sender, { cwd: "/repo", cols: -5, rows: 1e9 });
		invoke(TERMINAL_CHANNELS.RESIZE, sender, "t1", Number.NaN, 5000);

		expect(service.opened[0]).toMatchObject({ request: { cols: 2, rows: 1000 } });
		expect(session.resizes).toEqual([[2, 1000]]);
	});

	it("前台进程问不出来时回 null，供关闭确认走保守分支", () => {
		const sender = fakeSender();

		expect(invoke(TERMINAL_CHANNELS.FOREGROUND, sender, "t1")).toBeNull();
		session.foreground = "vim";
		expect(invoke(TERMINAL_CHANNELS.FOREGROUND, sender, "t1")).toBe("vim");
	});

	it("teardown 摘掉 handler 并杀光残留终端", () => {
		teardown();

		expect(mocks.removeHandler).toHaveBeenCalledWith(TERMINAL_CHANNELS.OPEN);
		expect(mocks.removeHandler).not.toHaveBeenCalledWith(TERMINAL_CHANNELS.EVENT);
		expect(service.disposeAllCalls).toBe(1);
	});
});
