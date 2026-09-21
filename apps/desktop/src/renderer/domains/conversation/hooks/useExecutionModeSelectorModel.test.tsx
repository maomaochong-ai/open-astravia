// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExecutionModeSelectorModel } from "./useExecutionModeSelectorModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("执行模式选择器", () => {
	beforeEach(() => {
		(window as unknown as { vetta: unknown }).vetta = {
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
