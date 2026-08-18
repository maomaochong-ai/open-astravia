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
});
