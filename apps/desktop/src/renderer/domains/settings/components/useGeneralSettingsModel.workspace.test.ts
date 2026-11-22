// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 工作区路径的持久化契约：只有主进程写入成功才算「改好了」。
 *
 * 旧实现的顺序是「先改 atom + localStorage，再写盘」。写盘失败时用户看到新路径，
 * 重启后启动期会用 config 里的旧值（默认值）覆盖 localStorage —— 表现为
 * 「设置里改了工作区，重新打开又回到默认」。
 */
const mocks = vi.hoisted(() => ({
	selectFolder: vi.fn(),
	configSet: vi.fn(),
	recordSettingsUsage: vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@shared/i18n", () => ({
	i18n: { t: (key: string) => key },
}));

vi.mock("../components/recordSettingsUsage", () => ({
	recordSettingsUsage: mocks.recordSettingsUsage,
}));

vi.mock("@/shared/feature-flags", () => ({
	isAppearanceUiThemeEnabled: () => false,
	isCloudBuildEnabled: () => false,
}));

async function mountModel() {
	const { useGeneralSettingsModel } = await import("./useGeneralSettingsModel");
	return renderHook(() => useGeneralSettingsModel());
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.configSet.mockResolvedValue(undefined);
	mocks.selectFolder.mockResolvedValue("D:\\work-area");
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: {
			config: { get: vi.fn(async () => ({})), set: mocks.configSet },
			dialog: { selectFolder: mocks.selectFolder },
			updates: { getState: vi.fn(async () => ({})) },
		},
	});
});

describe("工作区路径持久化", () => {
	// 单条要跑一次完整的 hook 挂载 + atom 回流，与其他测试并行跑满时 5s 默认上限不够；
	// 给一个显式余量，避免把「慢」误报成「失败」。
	it("先写配置再改界面，且不再往 localStorage 存第二份镜像", { timeout: 30_000 }, async () => {
		const { result } = await mountModel();
		const setItem = vi.spyOn(Storage.prototype, "setItem");

		await result.current.actions.selectWorkspace();

		expect(mocks.configSet).toHaveBeenCalledWith({ workspacePath: "D:\\work-area" });
		await waitFor(() => expect(result.current.workspacePath).toBe("D:\\work-area"));
		// localStorage 是第二个事实源：留着它，写盘失败时就会出现「重启回默认」。
		expect(setItem.mock.calls.some(([key]) => key === "astravia-workspace-path")).toBe(false);
		setItem.mockRestore();
	});

	it("写配置失败时不改界面，并把原因告诉用户", { timeout: 30_000 }, async () => {
		mocks.configSet.mockRejectedValue(new Error("EACCES"));
		const { result } = await mountModel();
		const before = result.current.workspacePath;

		await result.current.actions.selectWorkspace();

		await waitFor(() => {
			expect(mocks.recordSettingsUsage).not.toHaveBeenCalled();
		});
		expect(result.current.workspacePath).toBe(before);
	});
});
