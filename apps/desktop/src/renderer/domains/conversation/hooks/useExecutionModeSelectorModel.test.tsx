// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExecutionModeSelectorModel } from "./useExecutionModeSelectorModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const showToast = vi.fn();
vi.mock("@shared/store/toast-atoms", () => ({ showToast: (...args: unknown[]) => showToast(...args) }));

describe("执行模式选择器", () => {
	beforeEach(() => {
		showToast.mockClear();
		(window as unknown as { astravia: unknown }).astravia = {
			config: { get: vi.fn(async () => ({ sandbox: { status: "available" } })) },
		};
	});

	it("远程项目如实显示完全访问，沙盒选项禁用并说明原因，点了也不会去切换", async () => {
		// 主进程会把远程会话固定为完全访问；界面若仍显示「沙盒」，用户以为受保护而实际没有。
		const onSelectMode = vi.fn();
		const { result } = renderHook(() =>
			useExecutionModeSelectorModel({
				cwd: "ssh://host-1/srv/app",
				mode: "sandbox",
				isStreaming: false,
				onSelectMode,
			}),
		);
		await waitFor(() => expect(result.current.selectedOption.mode).toBe("full-access"));

		const sandbox = result.current.options.find((option) => option.mode === "sandbox");
		expect(sandbox).toMatchObject({
			disabled: true,
			selected: false,
			title: "executionModeSelector.sandboxUnavailableRemote",
		});

		act(() => result.current.onSelect("sandbox"));
		expect(onSelectMode).not.toHaveBeenCalled();
	});

	it("沙箱能力还在探测（unknown）时不提供可点的沙箱选项", async () => {
		// Windows 的宿主探测最长 10 秒，开机第一次打开面板读到的就是 unknown。
		// 若把它当成可用，用户点了会被主进程拒绝并回滚——表现为「切了没反应」。
		(window as unknown as { astravia: unknown }).astravia = {
			config: { get: vi.fn(async () => ({ sandbox: { status: "unknown", platform: "win32" } })) },
		};
		const { result } = renderHook(() =>
			useExecutionModeSelectorModel({ cwd: "C:/work", mode: "full-access", isStreaming: false, onSelectMode: vi.fn() }),
		);

		await waitFor(() =>
			expect(result.current.options.find((option) => option.mode === "sandbox")?.disabled).toBe(true),
		);
	});

	it("探测完成后重新打开弹层，沙箱选项自动放行", async () => {
		// 用可变状态而不是「第几次调用」：effect 在某些渲染模式下会被多调一次，
		// 靠调用顺序写断言会天生不稳。
		let status: "unknown" | "available" = "unknown";
		(window as unknown as { astravia: unknown }).astravia = {
			config: { get: vi.fn(async () => ({ sandbox: { status, platform: "win32" } })) },
		};

		const { result } = renderHook(() =>
			useExecutionModeSelectorModel({ cwd: "C:/work", mode: "full-access", isStreaming: false, onSelectMode: vi.fn() }),
		);
		await waitFor(() =>
			expect(result.current.options.find((option) => option.mode === "sandbox")?.disabled).toBe(true),
		);

		status = "available";
		act(() => result.current.onOpenChange(true));
		await waitFor(() =>
			expect(result.current.options.find((option) => option.mode === "sandbox")?.disabled).toBe(false),
		);
	});

	it("切换失败时弹出提示并带上主进程给的原因", async () => {
		const onSelectMode = vi.fn(async () => {
			throw new Error("windows 沙盒不可用：limited_host_capabilities");
		});
		const { result } = renderHook(() =>
			useExecutionModeSelectorModel({ cwd: "C:/work", mode: "full-access", isStreaming: false, onSelectMode }),
		);
		await waitFor(() => expect(result.current.selectedOption.mode).toBe("full-access"));

		act(() => result.current.onSelect("sandbox"));
		await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
		expect(showToast.mock.calls[0]?.[0]).toMatchObject({
			variant: "error",
			title: "executionModeSelector.switchFailedTitle",
			message: "windows 沙盒不可用：limited_host_capabilities",
		});
	});

	it("本地项目照常可以在两种模式间切换", async () => {
		const onSelectMode = vi.fn();
		const { result } = renderHook(() =>
			useExecutionModeSelectorModel({ cwd: "/work/app", mode: "sandbox", isStreaming: false, onSelectMode }),
		);
		await waitFor(() => expect(result.current.selectedOption.mode).toBe("sandbox"));
		expect(result.current.options.every((option) => !option.disabled)).toBe(true);

		act(() => result.current.onSelect("full-access"));
		await waitFor(() => expect(onSelectMode).toHaveBeenCalledWith("full-access"));
	});
});
