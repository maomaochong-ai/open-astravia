// @vitest-environment jsdom
import type { ImSignalBindEvent } from "@preload/api";
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

const { useSignalBindDialogModel } = await import("./useSignalBindDialogModel.js");

interface SignalStub {
	startBindCalls: number;
	startBindResult: { ok: boolean; error?: string };
	emit(event: ImSignalBindEvent): void;
	unsubscribeCalls: number;
}

function installSignalStub(): SignalStub {
	const handlers = new Set<(event: ImSignalBindEvent) => void>();
	const stub: SignalStub = {
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
				signal: {
					startBind: async () => {
						stub.startBindCalls += 1;
						return stub.startBindResult;
					},
					logout: async () => ({ ok: true }),
					subscribeBind: async (handler: (event: ImSignalBindEvent) => void) => {
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
	overrides: Partial<Parameters<typeof useSignalBindDialogModel>[0]> = {},
	hooks: { onConfirmedRefresh?: () => void; onOpenChange?: (open: boolean) => void } = {},
) {
	return renderHook(() =>
		useSignalBindDialogModel({
			open: true,
			onOpenChange: hooks.onOpenChange ?? (() => {}),
			bound: false,
			cliDetectedPath: "/opt/homebrew/bin/signal-cli",
			cliInstallHint: "brew install signal-cli",
			onLogout: () => {},
			onConfirmedRefresh: hooks.onConfirmedRefresh ?? (() => {}),
			onOpenAdvanced: () => {},
			onOpenGuide: () => {},
			...overrides,
		}),
	);
}

describe("useSignalBindDialogModel", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("未安装 signal-cli 时不发起绑定，只展示安装命令", async () => {
		const stub = installSignalStub();

		const { result } = renderDialog({ cliDetectedPath: undefined });

		await waitFor(() => {
			expect(result.current.bodyKind).toBe("failed");
		});
		expect(stub.startBindCalls).toBe(0);
		expect(result.current.cliMissing).toBe(true);
		expect(result.current.error).toContain("brew install signal-cli");
	});

	it("打开后自动发起链接并把 sgnl:// URI 渲染成二维码", async () => {
		const stub = installSignalStub();

		const { result, unmount } = renderDialog();

		await waitFor(() => {
			expect(stub.startBindCalls).toBe(1);
		});
		act(() => {
			stub.emit({ kind: "qr", type: "signal_qr", uri: "sgnl://linkdevice?uuid=x", attempt: 1 });
		});
		await waitFor(() => {
			expect(result.current.bodyKind).toBe("qr");
			expect(result.current.qrDataUrl).toBeDefined();
		});
		// Unmount inside the test so the QR render settles before the
		// environment is torn down.
		unmount();
	});

	it("链接完成后刷新配置并进入成功态", async () => {
		const stub = installSignalStub();
		const onConfirmedRefresh = vi.fn();

		const { result } = renderDialog({}, { onConfirmedRefresh });

		await waitFor(() => {
			expect(stub.startBindCalls).toBe(1);
		});
		act(() => {
			stub.emit({ kind: "bound", type: "signal_bound", account: "+8613800000000" });
		});
		await waitFor(() => {
			expect(result.current.bodyKind).toBe("confirmed");
		});
		expect(onConfirmedRefresh).toHaveBeenCalled();
	});

	it("失败事件带出 sidecar 的原因", async () => {
		const stub = installSignalStub();

		const { result } = renderDialog();

		await waitFor(() => {
			expect(stub.startBindCalls).toBe(1);
		});
		act(() => {
			stub.emit({
				kind: "status",
				type: "signal_bind_status",
				status: "failed",
				error: "signal-cli link: exit status 1",
			});
		});
		await waitFor(() => {
			expect(result.current.bodyKind).toBe("failed");
			expect(result.current.error).toBe("signal-cli link: exit status 1");
		});
	});

	it("已绑定时展示账号且不重复发起链接", async () => {
		const stub = installSignalStub();

		const { result } = renderDialog({ bound: true, account: "+8613800000000" });

		await waitFor(() => {
			expect(result.current.bodyKind).toBe("bound");
		});
		expect(stub.startBindCalls).toBe(0);
		expect(result.current.account).toBe("+8613800000000");
	});

	it("关闭对话框时取消事件订阅", async () => {
		const stub = installSignalStub();

		const { rerender } = renderHook(
			({ open }: { open: boolean }) =>
				useSignalBindDialogModel({
					open,
					onOpenChange: () => {},
					bound: false,
					cliDetectedPath: "/opt/homebrew/bin/signal-cli",
					cliInstallHint: "brew install signal-cli",
					onLogout: () => {},
					onConfirmedRefresh: () => {},
					onOpenAdvanced: () => {},
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
