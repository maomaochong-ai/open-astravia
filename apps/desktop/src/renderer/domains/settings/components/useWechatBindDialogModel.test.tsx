// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWechatBindDialogModel } from "./useWechatBindDialogModel";

/**
 * 解绑后再次绑定：宿主侧若没把 sidecar 拉起来，二维码事件永远不来。
 * 界面不能就此无限停在「正在生成二维码」——必须超时并给出可操作的原因。
 */
const mocks = vi.hoisted(() => ({
	subscribeBind: vi.fn(),
	startBind: vi.fn(),
	t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: mocks.t }),
}));

vi.mock("qrcode", () => ({
	default: { toDataURL: vi.fn(async () => "data:image/png;base64,stub") },
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	mocks.subscribeBind.mockResolvedValue(() => {});
	mocks.startBind.mockResolvedValue({ ok: true });
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: { im: { wechat: { subscribeBind: mocks.subscribeBind, startBind: mocks.startBind } } },
	});
});

afterEach(() => {
	vi.useRealTimers();
});

function render(open = true) {
	return renderHook(() =>
		useWechatBindDialogModel({
			open,
			onOpenChange: vi.fn(),
			bound: false,
			onLogout: vi.fn(),
			onOpenGuide: vi.fn(),
			onConfirmedRefresh: vi.fn(),
		}),
	);
}

describe("useWechatBindDialogModel", () => {
	it("宿主回报启动失败时直接进入失败态，不留在加载中", async () => {
		mocks.startBind.mockResolvedValue({ ok: false, error: "微信 sidecar 未运行，无法开始扫码" });

		const { result } = render();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(result.current.bodyKind).toBe("failed");
		expect(result.current.error).toBe("微信 sidecar 未运行，无法开始扫码");
	});

	it("启动成功但一直等不到二维码时超时失败，而不是无限加载", async () => {
		const { result } = render();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.bodyKind).toBe("loading");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(21_000);
		});

		expect(result.current.bodyKind).toBe("failed");
		expect(result.current.error).toBe("bindStartTimeout");
	});

	it("二维码到达后取消超时，不会把已经显示的二维码打成失败", async () => {
		let emit: ((event: unknown) => void) | undefined;
		mocks.subscribeBind.mockImplementation(async (handler: (event: unknown) => void) => {
			emit = handler;
			return () => {};
		});

		const { result } = render();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		await act(async () => {
			emit?.({ kind: "qr", url: "https://example.test/qr", attempt: 1 });
		});
		// 假时钟下不能用 waitFor（它靠真定时器轮询），冲洗微任务后直接断言。
		await act(async () => {
			await Promise.resolve();
		});
		expect(result.current.bodyKind).toBe("qr");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(21_000);
		});
		expect(result.current.bodyKind).toBe("qr");
	});
});
