// @vitest-environment jsdom
/**
 * 界面大小的「松手才生效」：拖动只改本地预览档位，松手（commit）才写主进程。
 * StepSlider 换成两个按钮分别触发 draft 与 commit，就能直接把这两条路径分开断言。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppearanceSettingsModel } from "./useAppearanceSettingsModel";

const setUiZoom = vi.fn();

vi.mock("@astravia-org/ui/step-slider", () => ({
	StepSlider: ({
		labels,
		index,
		onIndexChange,
		onIndexCommit,
		onCancel,
	}: {
		labels: readonly string[];
		index: number;
		onIndexChange?: (index: number) => void;
		onIndexCommit: (index: number) => void;
		onCancel?: () => void;
	}) => (
		<div>
			<span data-testid="shown">{labels[index]}</span>
			<button type="button" onClick={() => onIndexChange?.(labels.length - 1)}>
				draft-last
			</button>
			<button type="button" onClick={() => onIndexCommit(labels.length - 1)}>
				commit-last
			</button>
			<button type="button" onClick={() => onCancel?.()}>
				cancel
			</button>
		</div>
	),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { UiZoomControl } = await import("./AppearanceSettingsView.js");

function model(): AppearanceSettingsModel {
	return {
		actions: { setUiZoom, resetUiZoom: vi.fn() } as unknown as AppearanceSettingsModel["actions"],
		uiZoom: { factor: 1, stepIndex: 2, steps: [0.75, 0.9, 1, 1.1, 1.25, 1.5], default: 1 },
		labels: { uiZoomSliderLabel: "界面大小", uiZoomReset: "恢复默认大小" } as unknown as AppearanceSettingsModel["labels"],
	} as unknown as AppearanceSettingsModel;
}

describe("界面大小", () => {
	it("拖动只改预览，不写主进程；松手才提交", () => {
		setUiZoom.mockClear();
		render(<UiZoomControl model={model()} />);

		fireEvent.click(screen.getByRole("button", { name: "draft-last" }));
		expect(screen.getByTestId("shown").textContent).toBe("150%");
		expect(setUiZoom).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "commit-last" }));
		expect(setUiZoom).toHaveBeenCalledWith(1.5);
	});

	it("取消拖动后回到已生效的档位", () => {
		const { rerender } = render(<UiZoomControl model={model()} />);

		fireEvent.click(screen.getByRole("button", { name: "draft-last" }));
		expect(screen.getByTestId("shown").textContent).toBe("150%");

		fireEvent.click(screen.getByRole("button", { name: "cancel" }));
		rerender(<UiZoomControl model={model()} />);
		expect(screen.getByTestId("shown").textContent).toBe("100%");
	});

	it("把档位值而不是百分比交给模型", () => {
		setUiZoom.mockClear();
		render(<UiZoomControl model={model()} />);

		fireEvent.click(screen.getByRole("button", { name: "commit-last" }));
		fireEvent.click(screen.getByRole("button", { name: "commit-last" }));
		// 两次 commit 都是 150%，模型没变时调用方会自己跳过；这里只保证把档位传下去而不是传百分比。
		expect(setUiZoom).toHaveBeenCalledWith(1.5);
		expect(setUiZoom).not.toHaveBeenCalledWith(150);
	});
});
