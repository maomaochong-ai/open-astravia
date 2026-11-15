// @vitest-environment jsdom
/**
 * 设置 → 通用 → 应用 → 「查看版本介绍」的整条链路。
 *
 * 这条链路曾经断在中间：atom、hook、对话框都在，但设置页那一行只渲染了「检查更新」一颗按钮，
 * 于是用户点不到版本介绍。这个用例从设置行进入，一路点到对话框真的出现为止，
 * 中间任何一环被摘掉都会红。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAtomValue } from "jotai";
import { Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateRestartDialog } from "../components/UpdateRestartDialog";
import { updaterCurrentNotesDialogOpenAtom } from "../store/updater-atoms";
import { useUpdateCheckerModel } from "./useUpdateCheckerModel";
import { UpdateCheckerAction } from "@astravia-org/theme-ui/overlays";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const getCurrentReleaseNote = vi.fn(async () => "## 新增\n\n- 版本介绍的正文");

/** 设置行：与 `GeneralSettingsView` 里那一行同样的拼法（action 在右、detail 挂行下）。 */
function SettingsAppRow(): JSX.Element {
	const model = useUpdateCheckerModel();
	const notesOpen = useAtomValue(updaterCurrentNotesDialogOpenAtom);
	return (
		<>
			<UpdateCheckerAction
				checking={model.checking}
				labels={model.labels}
				onCheck={model.onCheck}
				{...(model.onViewCurrent ? { onViewCurrent: model.onViewCurrent } : {})}
				phase={model.phase}
			/>
			{notesOpen && <UpdateRestartDialog />}
		</>
	);
}

function mount() {
	return render(
		<Provider>
			<SettingsAppRow />
		</Provider>,
	);
}

beforeEach(() => {
	(window as unknown as { astravia: unknown }).astravia = {
		updater: {
			check: vi.fn(async () => undefined),
			download: vi.fn(async () => undefined),
			install: vi.fn(async () => undefined),
			getCurrentReleaseNote,
		},
	};
});

afterEach(() => {
	cleanup();
	getCurrentReleaseNote.mockClear();
});

describe("设置页的版本介绍入口", () => {
	it("行上同时有「检查更新」与「查看版本介绍」两颗按钮", () => {
		mount();
		expect(screen.getByTestId("updater-check")).toBeTruthy();
		expect(screen.getByTestId("updater-view-current")).toBeTruthy();
	});

	it("点「查看版本介绍」弹出当前版本的说明，而不是什么都不发生", async () => {
		mount();
		expect(screen.queryByRole("dialog")).toBeNull();

		await act(async () => {
			fireEvent.click(screen.getByTestId("updater-view-current"));
		});

		const dialog = await screen.findByRole("dialog");
		expect(dialog).toBeTruthy();
		// 标题带上当前版本号，与「检查更新」的对话框区分开。
		expect(dialog.getAttribute("aria-label")).toBe("updateDialog.currentTitle");
		expect(getCurrentReleaseNote).toHaveBeenCalledTimes(1);
	});
});
