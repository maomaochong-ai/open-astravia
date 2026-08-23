import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@astravia-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ColorPicker } from "../src/mockup/ColorPicker";

/** React 19 的 act 需要这个开关，否则每次更新都会告警。 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function open(): void {
	const trigger = document.body.querySelector<HTMLElement>("button[aria-expanded]");
	if (!trigger) throw new Error("missing trigger");
	act(() => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

function swatchTitles(): string[] {
	return [...document.body.querySelectorAll<HTMLElement>("button[title]")].map(
		(element) => element.getAttribute("title") ?? "",
	);
}

describe("ColorPicker theme swatches", () => {
	// theme.css 里多个 token 指向同一档颜色是常态；照单全收就是一排看不出区别的
	// 色块，而且 React 会因为重复 key 在改颜色时刷一屏告警。
	it("shows each theme color once, whatever case it was written in", () => {
		act(() => {
			root.render(
				<ColorPicker
					label="bg"
					color="#000000"
					palette={["#a3a3a3", "#A3A3A3", "#f5f5f1", "#a3a3a3"]}
					onPick={vi.fn()}
				/>,
			);
		});
		open();

		expect(swatchTitles()).toEqual(["#a3a3a3", "#f5f5f1"]);
	});

	/**
	 * 面板是 fixed 定位，按视口坐标算 left/top。工作台的悬浮选项卡带 backdrop-filter，
	 * 而带 filter/backdrop-filter 的元素会成为 fixed 后代的包含块——留在原地就等于按
	 * 卡片坐标定位，面板被推出卡片外（卡片长出横向滚动条，色板看不见）。
	 */
	it("renders the panel outside its own subtree so no filtered ancestor can contain it", () => {
		act(() => {
			root.render(<ColorPicker label="bg" color="#000000" palette={["#a3a3a3"]} onPick={vi.fn()} />);
		});
		open();

		const swatch = document.body.querySelector<HTMLElement>("button[title='#a3a3a3']");
		expect(swatch).not.toBeNull();
		expect(host.contains(swatch)).toBe(false);
	});

	it("renders no swatch row without a palette", () => {
		act(() => root.render(<ColorPicker label="bg" color="#000000" palette={[]} onPick={vi.fn()} />));
		open();

		expect(swatchTitles()).toEqual([]);
	});
});
