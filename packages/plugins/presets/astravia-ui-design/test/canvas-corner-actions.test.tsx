/**
 * 画布右上角按钮组的构成与顺序：备注显隐在最左、运行在最右，中间是
 * 刷新 / 导出渲染图 / 版本历史。顺序是这次布局调整的产品要求，不是实现细节，
 * 所以按 DOM 顺序断言。
 */
import { expect, it, vi } from "vitest";

vi.mock("@astravia-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act } from "react";
import { createRoot } from "react-dom/client";
import { CanvasCornerActions } from "../src/canvas/CanvasCornerActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
	buttons: HTMLButtonElement[];
	calls: string[];
	cleanup(): void;
}

function render(options: { notesVisible?: boolean; runDisabled?: boolean } = {}): Rendered {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	const calls: string[] = [];
	act(() => {
		root.render(
			<CanvasCornerActions
				offsetTop={0}
				historyOpen={false}
				notesVisible={options.notesVisible ?? true}
				onToggleNotes={() => calls.push("notes")}
				onRefresh={() => calls.push("refresh")}
				onExport={() => calls.push("export")}
				onToggleHistory={() => calls.push("history")}
				onRun={() => calls.push("run")}
				runDisabled={options.runDisabled ?? false}
			/>,
		);
	});
	return {
		buttons: [...host.querySelectorAll("button")],
		calls,
		cleanup: () => {
			act(() => root.unmount());
			host.remove();
		},
	};
}

it("orders the group as notes | refresh history export | run", () => {
	const { buttons, calls, cleanup } = render();
	expect(buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
		"notes.visibility.hide",
		"canvas.refresh",
		"controlbar.history",
		"controlbar.exportMockup.label",
		"canvas.run",
	]);
	// 备注开关是真开关，状态要能被读出来（不只是底色深浅）。
	expect(buttons[0]?.getAttribute("role")).toBe("switch");
	expect(buttons[0]?.getAttribute("aria-checked")).toBe("true");
	// 打开面板的两个动作带文字：纯 icon 认不出「版本历史」和「导出渲染图」的区别。
	expect(buttons[2]?.textContent).toContain("controlbar.history");
	expect(buttons[3]?.textContent).toContain("controlbar.exportMockup.label");

	act(() => buttons[0]?.click());
	act(() => buttons[4]?.click());
	expect(calls).toEqual(["notes", "run"]);
	cleanup();
});

it("disables run when the design has no frames", () => {
	const { buttons, calls, cleanup } = render({ runDisabled: true });
	const run = buttons[4];
	expect(run?.disabled).toBe(true);
	act(() => run?.click());
	expect(calls).toEqual([]);
	cleanup();
});
