// @vitest-environment jsdom
import type { ImFeishuBindEvent } from "@preload/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		// Echo the key plus its interpolation so assertions can check both
		// the branch taken and the value handed to the user.
		t: (key: string, opts?: Record<string, unknown>) =>
			opts ? `${key}:${Object.values(opts).join(",")}` : key,
		i18n: { exists: () => true },
	}),
}));

vi.mock("qrcode", () => ({
	default: { toDataURL: async (text: string) => `data:image/png;base64,${btoa(text)}` },
}));

const { useFeishuBindDialogModel } = await import("./useFeishuBindDialogModel.js");

interface FeishuStub {
	startBindCalls: number;
	startBindResult: { ok: boolean; error?: string };
	emit(event: ImFeishuBindEvent): void;
	unsubscribeCalls: number;
}

function installFeishuStub(): FeishuStub {
	const handlers = new Set<(event: ImFeishuBindEvent) => void>();
	const stub: FeishuStub = {
		startBindCalls: 0,
		startBindResult: { ok: true },
		unsubscribeCalls: 0,
		emit: (event) => {
			for (const handler of handlers) handler(event);
		},
	};
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			im: {
				feishu: {
					startBind: async () => {
						stub.startBindCalls += 1;
						return stub.startBindResult;
					},
					subscribeBind: async (handler: (event: ImFeishuBindEvent) => void) => {
						handlers.add(handler);
						return () => {
							handlers.delete(handler);
							stub.unsubscribeCalls += 1;
						};
					},
				},
			},
		},
	});
	return stub;
}

function renderDialog(
	overrides: Partial<Parameters<typeof useFeishuBindDialogModel>[0]> = {},
	hooks: { onConfirmedRefresh?: () => void; onOpenChange?: (open: boolean) => void } = {},
) {
	return renderHook(() =>
		useFeishuBindDialogModel({
			open: true,
			onOpenChange: hooks.onOpenChange ?? (() => {}),
			bound: false,
			onLogout: () => {},
			onConfirmedRefresh: hooks.onConfirmedRefresh ?? (() => {}),
			onOpenManual: () => {},
			onOpenGuide: () => {},
			...overrides,
		}),
	);
}

describe("useFeishuBindDialogModel", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("打开后自动发起注册并把验证链接渲染成二维码", async () => {
		const stub = installFeishuStub();

		const { result, unmount } = renderDialog();

		await waitFor(() => {
			expect(stub.startBindCalls).toBe(1);
		});
		act(() => {
			stub.emit({
				kind: "qr",
				type: "feishu_qr",
				url: "https://accounts.feishu.cn/app/registration?code=A",
				expireIn: 600,
				attempt: 1,
			});
		});
		await waitFor(() => {
			expect(result.current.bodyKind).toBe("qr");
			expect(result.current.qrDataUrl).toBeDefined();
		});
		// Unmount inside the test so the QR render settles before the
		// environment is torn down.
		unmount();
	});

	it("注册完成后刷新配置并进入成功态", async () => {
		const stub = installFeishuStub();
		const onConfirmedRefresh = vi.fn();

		const { result } = renderDialog({}, { onConfirmedRefresh });

		await waitFor(() => {
			expect(stub.startBindCalls).toBe(1);
		});
		act(() => {
			stub.emit({ kind: "bound", type: "feishu_bound", appId: "cli_new", appSecret: "sec" });
		});
		await waitFor(() => {
			expect(result.current.bodyKind).toBe("confirmed");
		});
		expect(onConfirmedRefresh).toHaveBeenCalled();
	});

	it("二维码过期时给出重新扫码提示，而不是原始错误码", async () => {
		const stub = installFeishuStub();

		const { result } = renderDialog();

		await waitFor(() => {
			expect(stub.startBindCalls).toBe(1);
		});
		act(() => {
			stub.emit({ kind: "status", type: "feishu_bind_status", status: "expired" });
		});
		await waitFor(() => {
			expect(result.current.bodyKind).toBe("failed");
			expect(result.current.error).toBe("feishuQrExpired");
		});
	});

	it("失败事件带出 sidecar 的原因", async () => {
		const stub = installFeishuStub();

		const { result } = renderDialog();

		await waitFor(() => {
			expect(stub.startBindCalls).toBe(1);
		});
		act(() => {
			stub.emit({
				kind: "status",
				type: "feishu_bind_status",
				status: "failed",
				error: "授权被拒绝，可重新扫码。",
			});
		});
		await waitFor(() => {
			expect(result.current.bodyKind).toBe("failed");
			expect(result.current.error).toBe("授权被拒绝，可重新扫码。");
		});
	});

	it("已接入时展示 App ID 且不重复发起注册", async () => {
		const stub = installFeishuStub();

		const { result } = renderDialog({ bound: true, appId: "cli_abc" });

		await waitFor(() => {
			expect(result.current.bodyKind).toBe("bound");
		});
		expect(stub.startBindCalls).toBe(0);
		expect(result.current.appId).toBe("cli_abc");
	});

	it("关闭对话框时取消事件订阅", async () => {
		const stub = installFeishuStub();

		const { rerender } = renderHook(
			({ open }: { open: boolean }) =>
				useFeishuBindDialogModel({
					open,
					onOpenChange: () => {},
					bound: false,
					onLogout: () => {},
					onConfirmedRefresh: () => {},
					onOpenManual: () => {},
					onOpenGuide: () => {},
				}),
			{ initialProps: { open: true } },
		);

		await waitFor(() => {
			expect(stub.startBindCalls).toBe(1);
		});
		rerender({ open: false });
		await waitFor(() => {
			expect(stub.unsubscribeCalls).toBe(1);
		});
	});
});
