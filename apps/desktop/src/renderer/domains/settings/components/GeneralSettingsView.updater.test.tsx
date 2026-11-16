// @vitest-environment jsdom
/**
 * 设置 → 通用 → 应用：「查看版本介绍」必须真的渲染出来。
 *
 * 这条路径断在**适配层**——`UpdateCheckerAction` 要求文案与回调同时给才出按钮，
 * 而宿主只转发了 `checking / labels / onCheck / phase`，于是文案在、回调不在，
 * 按钮静默消失，看起来就像「这一版没有版本介绍」。这个用例从宿主适配层进入，
 * 只断言「按钮存在且点了会打开当前版本的说明」，对话框排版由
 * `useUpdateCheckerModel.current-notes.test.tsx` 单独覆盖。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getDefaultStore, useAtomValue } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updaterCurrentNotesDialogOpenAtom, updaterStateAtom } from "@shared/store/updater-atoms";
import { GeneralSettingsView } from "./GeneralSettingsView";
import type { GeneralSettingsModel } from "./useGeneralSettingsModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		// 只对下载文案插值 progress，其余 key 原样返回——这样能断言百分比真的透传了。
		t: (key: string, params?: Record<string, unknown>) =>
			key === "updaterDownloading" && params ? `downloading:${params.progress}` : key,
		i18n: { exists: () => true },
	}),
}));

// 代理区块要读 models.json，与本用例无关，直接短路（含它自己的数据 hook）。
vi.mock("./ProxySettingsSection", () => ({ ProxySettingsSection: () => null }));
vi.mock("./useProxySettingsModel", () => ({ useProxySettingsModel: () => ({}) }));

const noop = (): void => undefined;

/** 只提供视图真正会读到的字段；其余留空不影响这一行。 */
function stubModel(): GeneralSettingsModel {
	return {
		actions: {
			changeExecutionMode: async () => undefined,
			changeNotificationEventSound: noop,
			changeNotificationEventSystem: noop,
			changeNotificationSoundScope: noop,
			changeNotificationSoundVolume: noop,
			changeNotificationSystemScope: noop,
			exportDiagnostics: async () => undefined,
			previewNotificationSound: noop,
			resetWorkspace: async () => undefined,
			selectWorkspace: async () => undefined,
			startAppGuide: noop,
			toggleDebug: noop,
			toggleNotifications: noop,
			toggleSound: noop,
		},
		debugMode: false,
		executionMode: "full-access",
		exportingDiagnostics: false,
		labels: {
			appVersion: "当前版本",
			debugMode: "调试模式",
			debugModeDescription: "d",
			export: "导出",
			exportDiagnostics: "导出诊断",
			exportDiagnosticsDescription: "d",
			exporting: "导出中",
			fullAccess: "完全访问",
			notificationPreview: "预览",
			notificationPreviewAction: "试听",
			notificationScopes: { always: "始终", "away-from-session": "离开时", "background-only": "后台" },
			notificationSounds: {},
			notificationSound: "提示音",
			notificationSoundDescription: "d",
			notificationSoundTiming: "时机",
			reset: "重置",
			sandboxDescription: "d",
			sandboxTitle: "沙箱",
			sections: { app: "应用", basics: "基础", developer: "开发者", notifications: "通知" },
			startAppGuide: "开始引导",
			startAppGuideAction: "开始",
			startAppGuideDescription: "d",
			systemNotifications: "系统通知",
			systemNotificationsDescription: "d",
			title: "通用",
			useSandbox: "使用沙箱",
			workspaceDescription: "d",
			workspaceTitle: "工作区",
		},
		notificationsEnabled: false,
		notificationPreferences: { soundEnabled: false, soundScope: "always" },
		sandboxUnavailableReason: null,
		workspacePath: "/tmp/workspace",
	} as unknown as GeneralSettingsModel;
}

function NotesProbe(): JSX.Element {
	const open = useAtomValue(updaterCurrentNotesDialogOpenAtom);
	return <span data-testid="notes-open">{open ? "open" : "closed"}</span>;
}

beforeEach(() => {
	(window as unknown as { astravia: unknown }).astravia = {
		updater: {
			check: vi.fn(async () => undefined),
			download: vi.fn(async () => undefined),
			getCurrentReleaseNote: vi.fn(async () => "## 新增\n\n- x"),
			install: vi.fn(async () => undefined),
		},
	};
});

afterEach(cleanup);

describe("设置页「当前版本」这一行", () => {
	it("同时有「查看版本介绍」与「检查更新」，点前者打开当前版本说明", async () => {
		render(
			<>
				<GeneralSettingsView model={stubModel()} />
				<NotesProbe />
			</>,
		);

		expect(screen.getByTestId("updater-check")).toBeTruthy();
		const notes = screen.getByTestId("updater-view-current");
		expect(screen.getByTestId("notes-open").textContent).toBe("closed");

		await act(async () => {
			fireEvent.click(notes);
		});
		expect(screen.getByTestId("notes-open").textContent).toBe("open");
	});

	it("下载中时「检查更新」按钮显示真实下载百分比，而不是恒为 0%", async () => {
		getDefaultStore().set(updaterStateAtom, { phase: "downloading", progress: 0.42, currentVersion: "1.0.0" });
		render(<GeneralSettingsView model={stubModel()} />);

		const button = screen.getByTestId("updater-check");
		expect(button.textContent).toContain("downloading:42");
		expect(button.hasAttribute("disabled")).toBe(true);
	});
});
