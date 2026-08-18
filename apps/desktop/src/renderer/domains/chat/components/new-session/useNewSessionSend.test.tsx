// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { OpenSessionOptions, SessionExecutionMode } from "@shared/store/atoms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNewSessionSend } from "./useNewSessionSend";

const perf = vi.hoisted(() => ({
	begin: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
	mark: vi.fn(),
}));

vi.mock("@shared/lib/perf-send", () => ({
	perfSendBegin: perf.begin,
	perfSendMark: perf.mark,
}));

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: (value) => resolvePromise?.(value) };
}

describe("useNewSessionSend", () => {
	beforeEach(() => vi.clearAllMocks());

	it("dispatches at prompt-ready before hydration finishes and suppresses duplicate submits", async () => {
		const opened = deferred<void>();
		const openSession = vi.fn(
			(_cwd: string, _path?: string, _mode?: SessionExecutionMode, options?: OpenSessionOptions) => {
				options?.onPromptReady?.();
				return opened.promise;
			},
		);
		const sendMessage = vi.fn(async () => ({ status: "sent" as const }));
		const { result } = renderHook(() =>
			useNewSessionSend({ cwd: "C:/workspace", executionMode: "sandbox", openSession, sendMessage }),
		);

		let firstSend: Promise<void> | undefined;
		act(() => {
			firstSend = result.current.send();
			void result.current.send();
		});

		expect(openSession).toHaveBeenCalledOnce();
		expect(openSession).toHaveBeenCalledWith(
			"C:/workspace",
			undefined,
			"sandbox",
			expect.objectContaining({ interactionId: "00000000-0000-4000-8000-000000000001" }),
		);
		expect(sendMessage).toHaveBeenCalledWith(undefined, {
			interactionId: "00000000-0000-4000-8000-000000000001",
		});

		await act(async () => {
			opened.resolve(undefined);
			await firstSend;
		});
	});

	it("does not dispatch and releases the duplicate guard after a create failure", async () => {
		const openSession = vi.fn(async () => {
			throw new Error("create failed");
		});
		const sendMessage = vi.fn();
		const { result } = renderHook(() =>
			useNewSessionSend({ cwd: "C:/workspace", executionMode: "full-access", openSession, sendMessage }),
		);

		await act(async () => {
			await expect(result.current.send()).rejects.toThrow("create failed");
		});

		expect(sendMessage).not.toHaveBeenCalled();
		await expect(result.current.send()).rejects.toThrow("create failed");
		expect(openSession).toHaveBeenCalledTimes(2);
	});
	it("先跑完准备步骤再开会话：待创建项目落盘后用真实 cwd 发送", async () => {
		const prepareCwd = vi.fn(async () => "/w/created");
		const openSession = vi.fn(
			(_cwd: string, _path?: string, _mode?: SessionExecutionMode, options?: OpenSessionOptions) => {
				options?.onPromptReady?.();
				return Promise.resolve();
			},
		);
		const sendMessage = vi.fn(async () => ({ status: "sent" as const }));
		const { result } = renderHook(() =>
			useNewSessionSend({
				cwd: "C:/workspace",
				executionMode: "sandbox",
				prepareCwd,
				openSession,
				sendMessage,
			}),
		);

		await act(async () => {
			await result.current.send("你好");
		});

		expect(prepareCwd).toHaveBeenCalledOnce();
		expect(openSession).toHaveBeenCalledWith("/w/created", undefined, "sandbox", expect.anything());
		expect(sendMessage).toHaveBeenCalledWith("你好", expect.anything());
	});

	it("准备步骤放弃（返回 null）时既不开会话也不发消息，且闸门已释放", async () => {
		const prepareCwd = vi.fn(async () => null);
		const openSession = vi.fn(async () => {});
		const sendMessage = vi.fn(async () => ({ status: "sent" as const }));
		const { result } = renderHook(() =>
			useNewSessionSend({
				cwd: "C:/workspace",
				executionMode: "sandbox",
				prepareCwd,
				openSession,
				sendMessage,
			}),
		);

		await act(async () => {
			await result.current.send("你好");
		});

		expect(openSession).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();

		// 闸门释放后仍可重试（用户改个名字再发一次）。
		await act(async () => {
			await result.current.send("你好");
		});
		expect(prepareCwd).toHaveBeenCalledTimes(2);
	});

	it("准备期间连点第二次发送不会重复触发准备步骤，避免创建出两个项目", async () => {
		const prepared = deferred<string | null>();
		const prepareCwd = vi.fn(() => prepared.promise);
		const openSession = vi.fn(
			(_cwd: string, _path?: string, _mode?: SessionExecutionMode, options?: OpenSessionOptions) => {
				options?.onPromptReady?.();
				return Promise.resolve();
			},
		);
		const sendMessage = vi.fn(async () => ({ status: "sent" as const }));
		const { result } = renderHook(() =>
			useNewSessionSend({
				cwd: "C:/workspace",
				executionMode: "sandbox",
				prepareCwd,
				openSession,
				sendMessage,
			}),
		);

		let firstSend: Promise<void> | undefined;
		act(() => {
			firstSend = result.current.send();
			void result.current.send();
		});

		expect(prepareCwd).toHaveBeenCalledOnce();

		await act(async () => {
			prepared.resolve("/w/created");
			await firstSend;
		});
		expect(openSession).toHaveBeenCalledOnce();
	});
});
