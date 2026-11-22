// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS, useSandboxAvailability } from "./useSandboxAvailability";

/**
 * 设置页与模型选择器共用这一份判定，所以「探测未完成」与「真的不可用」必须给出不同结论：
 * 前者继续轮询并自动放行，后者给出可展示的原因且不再重读。旧实现两处各读一次快照，
 * 一处把 unknown 当可用、一处当不可用，同一台机器上两个入口说法不一致。
 */
const mocks = vi.hoisted(() => ({
	configGet: vi.fn(),
	t: (key: string, options?: { platform?: string; reason?: string }) =>
		options ? `${key}:${options.platform}:${options.reason}` : key,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: mocks.t }),
}));

function capability(status: string, extra: Record<string, unknown> = {}) {
	// 主进程 config.get() 返回的就是配置本体，不是 { config } 再包一层。
	return { sandbox: { status, platform: "win32", ...extra } };
}

beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: { config: { get: mocks.configGet } },
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useSandboxAvailability", () => {
	it("探测未完成时先按不可用处理，并带上 checking 原因", async () => {
		mocks.configGet.mockResolvedValue(capability("unknown"));

		const { result } = renderHook(() => useSandboxAvailability());

		await waitFor(() => expect(result.current.reason).toContain("win32:checking"));
		expect(result.current.status).toBe("unknown");
	});

	it("探测落地为可用时自动放行，不需要用户重开面板", async () => {
		vi.useFakeTimers();
		mocks.configGet.mockResolvedValueOnce(capability("unknown")).mockResolvedValue(capability("available"));

		const { result } = renderHook(() => useSandboxAvailability());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.reason).toContain("checking");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2_000);
		});

		expect(result.current.status).toBe("available");
		expect(result.current.reason).toBeNull();
	});

	it("真的不可用时给出主进程的原因，并且不再轮询", async () => {
		vi.useFakeTimers();
		mocks.configGet.mockResolvedValue(capability("unavailable", { reason: "binary_not_found" }));

		const { result } = renderHook(() => useSandboxAvailability());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.reason).toContain("win32:binary_not_found");

		const readsAfterConclusion = mocks.configGet.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(6_000);
		});
		// 已有结论的机器不该每 1.5 秒读一次配置。
		expect(mocks.configGet.mock.calls.length).toBe(readsAfterConclusion);
	});

	it("读取配置失败也不把沙盒判成可用", async () => {
		mocks.configGet.mockRejectedValue(new Error("ipc down"));

		const { result } = renderHook(() => useSandboxAvailability());

		await waitFor(() => expect(result.current.reason).toContain("unknown_error"));
		expect(result.current.reason).not.toBeNull();
	});

	it("refresh 会立即重读，供弹层打开时使用", async () => {
		mocks.configGet.mockResolvedValue(capability("unavailable", { reason: "binary_not_found" }));
		const { result } = renderHook(() => useSandboxAvailability());
		await waitFor(() => expect(result.current.reason).toContain("binary_not_found"));

		mocks.configGet.mockResolvedValue(capability("available"));
		act(() => result.current.refresh());

		await waitFor(() => expect(result.current.status).toBe("available"));
	});

	/*
	 * 超时会停掉轮询，但「重新打开弹层」必须能把它再拉起来。
	 * 轮询 effect 的依赖是 [status, read]，status 在探测未完成时恒为 unknown，
	 * 只重置计时不重建 effect 的话，轮询就再也起不来了——用户看到「一直是灰的」。
	 */
	it("超时停掉轮询后，refresh 能重新拉起它", async () => {
		vi.useFakeTimers();
		mocks.configGet.mockResolvedValue(capability("unknown"));
		const { result } = renderHook(() => useSandboxAvailability());

		// 跑过预算：poll 自行 clearInterval。
		await act(async () => {
			await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 12);
		});
		const readsAfterBudget = mocks.configGet.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
		});
		expect(mocks.configGet.mock.calls.length).toBe(readsAfterBudget);

		// 弹层重新打开 → refresh 必须把轮询重启。
		act(() => result.current.refresh());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
		});
		expect(mocks.configGet.mock.calls.length).toBeGreaterThan(readsAfterBudget);
	});
});
