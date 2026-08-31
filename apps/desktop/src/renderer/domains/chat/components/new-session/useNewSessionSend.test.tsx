// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { OpenSessionOptions, SessionExecutionMode, StagedSendInput } from "@shared/store/atoms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNewSessionSend } from "./useNewSessionSend";

const perf = vi.hoisted(() => ({
	begin: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
	mark: vi.fn(),
}));

const stagedSend = vi.hoisted(() => ({
	restore: vi.fn(),
	stage: vi.fn<(overrideText?: string, interactionId?: string) => StagedSendInput | null>(() => ({
		draftKey: "new:C:/workspace",
		rawText: "hello",
		hasOverride: false,
		attachedImages: [],
		mentionedFiles: [],
		appshot: null,
		selectedModel: null,
		optimisticMessage: { id: "user-staged", role: "user" as const, text: "hello" },
	})),
}));

vi.mock("@shared/lib/perf-send", () => ({
	perfSendBegin: perf.begin,
	perfSendMark: perf.mark,
}));

vi.mock("../../services/staged-new-session-send", () => ({
	restoreStagedNewSessionSend: stagedSend.restore,
	stageNewSessionSend: stagedSend.stage,
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
	it("leaves Agent configuration to the host when creating a conversation", async () => {
		const openSession = vi.fn(
			async (_cwd: string, _path?: string, _mode?: SessionExecutionMode, _options?: OpenSessionOptions) => {},
		);
		const { result } = renderHook(() =>
			useNewSessionSend({
				cwd: "C:/workspace",
				executionMode: "sandbox",
				openSession,
				sendMessage: async () => undefined,
			}),
		);
		await act(async () => {
			await result.current.send();
		});
		expect(openSession).toHaveBeenCalledOnce();
		expect(openSession.mock.calls[0]?.[3]).not.toHaveProperty("agentConfiguration");
	});
	beforeEach(() => {
		vi.clearAllMocks();
		stagedSend.stage.mockReturnValue({
			draftKey: "new:C:/workspace",
			rawText: "hello",
			hasOverride: false,
			attachedImages: [],
			mentionedFiles: [],
			appshot: null,
			selectedModel: null,
			optimisticMessage: { id: "user-staged", role: "user", text: "hello" },
		});
	});

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
			expect.objectContaining({
				interactionId: "00000000-0000-4000-8000-000000000001",
				navigateBeforeCreate: true,
				preserveMessagesBeforeCreate: true,
			}),
		);
		expect(sendMessage).toHaveBeenCalledWith(undefined, {
			interactionId: "00000000-0000-4000-8000-000000000001",
			stagedInput: expect.objectContaining({ optimisticMessage: expect.objectContaining({ id: "user-staged" }) }),
		});

		await act(async () => {
			opened.resolve(undefined);
			await firstSend;
		});
	});

	it("does not dispatch and releases the duplicate guard after a create failure", async () => {
		const openSession = vi.fn(
			async (_cwd: string, _path?: string, _mode?: SessionExecutionMode, options?: OpenSessionOptions) => {
				const error = new Error("create failed");
				options?.onCreateError?.(error);
				throw error;
			},
		);
		const sendMessage = vi.fn();
		const { result } = renderHook(() =>
			useNewSessionSend({ cwd: "C:/workspace", executionMode: "full-access", openSession, sendMessage }),
		);

		await act(async () => {
			await expect(result.current.send()).rejects.toThrow("create failed");
		});

		expect(sendMessage).not.toHaveBeenCalled();
		expect(stagedSend.restore).toHaveBeenCalledTimes(1);
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
		expect(sendMessage).toHaveBeenCalledWith(
			undefined,
			expect.objectContaining({ stagedInput: expect.anything() }),
		);
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

	it("does not create a runtime when staging finds no sendable input", async () => {
		stagedSend.stage.mockReturnValueOnce(null);
		const openSession = vi.fn(async () => {});
		const sendMessage = vi.fn(async () => ({ status: "sent" as const }));
		const { result } = renderHook(() =>
			useNewSessionSend({ cwd: "C:/workspace", executionMode: "sandbox", openSession, sendMessage }),
		);

		await act(async () => {
			await result.current.send();
		});

		expect(openSession).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
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
