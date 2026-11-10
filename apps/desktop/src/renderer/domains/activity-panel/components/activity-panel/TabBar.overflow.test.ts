// @vitest-environment jsdom

import { TabBar } from "@shared/components/ui/tab-bar";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("motion/react", () => ({ motion: { span: () => null } }));

class ResizeObserverStub {
	disconnect(): void {}
	observe(): void {}
}

/**
 * 行宽取 290 而不是整数：这个宽度能区分「页签间距是否被算进可用宽度」——
 * 算上间距时第三个页签放不下（89×3 = 267 > 290-32+4），不算时刚好放得下（85×3 = 255 ≤ 290-32）。
 */
const ROW_WIDTH = 290;
/** 每个页签量出来的自然宽度。 */
const TAB_WIDTH = 85;

describe("TabBar 排版", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		vi.stubGlobal("ResizeObserver", ResizeObserverStub);
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(ROW_WIDTH);
		vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
			return this.dataset.tabkey == null ? 0 : TAB_WIDTH;
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function render(items: Array<{ key: string; label: string }>, onOverflowChange?: (keys: string[]) => void): void {
		act(() => {
			root.render(
				createElement(TabBar, {
					items,
					value: items[0]?.key ?? "",
					onChange: vi.fn(),
					...(onOverflowChange ? { onOverflowChange } : {}),
				}),
			);
		});
	}

	it("页签之间没有垂直分隔线", () => {
		render([
			{ key: "a", label: "A" },
			{ key: "b", label: "B" },
			{ key: "c", label: "C" },
		]);
		expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
		expect(container.querySelector('[class*="w-px"]')).toBeNull();
	});

	it("把页签之间的间距算进可用宽度，收不下的收进下拉", () => {
		const onOverflowChange = vi.fn();
		render(
			[
				{ key: "a", label: "A" },
				{ key: "b", label: "B" },
				{ key: "c", label: "C" },
			],
			onOverflowChange,
		);
		// 300 - 32 边距 = 268；三个 85px 加两段 12px 间距共 279，第三個放不下。
		expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
		expect(onOverflowChange).toHaveBeenLastCalledWith(["c"]);
	});
});
