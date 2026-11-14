// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ModelSelectorView,
	type ModelSelectorLabels,
	type ModelSelectorProviderGroup,
} from "./ModelSelectorView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS: ModelSelectorLabels = {
	placeholder: "选择模型",
	searchPlaceholder: "搜索模型",
	clearSearch: "清空搜索",
	noResults: "没有匹配的模型",
	noResultsHint: "换个关键词试试",
	reasoningHeader: "思考强度",
	modelHeader: "模型",
	cloudOnly: "云端",
	favoritesHeader: "收藏",
	favorite: "收藏",
	unfavorite: "取消收藏",
	searchResultsHeader: "搜索结果",
	visionBadge: "识图",
	defaultBadge: "默认",
	levelLabel: (value) => value,
};

/** 120 个模型：超过窗口化阈值（60），当前模型落在第 80 行——正是「打开后要能看见」的场景。 */
const MODELS_PER_PROVIDER = 120;
const SELECTED_INDEX = 80;

function groups(): ModelSelectorProviderGroup[] {
	return [
		{
			provider: "primary",
			label: "Primary",
			models: Array.from({ length: MODELS_PER_PROVIDER }, (_, index) => ({
				key: `primary/model-${index}`,
				provider: "primary",
				modelId: `model-${index}`,
				displayName: `Model ${index}`,
			})),
		},
	];
}

const SELECTED_KEY = `primary/model-${SELECTED_INDEX}`;
const ROW_HEIGHT = 28;
const VIEWPORT_HEIGHT = 280;

let container: HTMLDivElement;
let root: Root;

function renderView(): void {
	act(() => {
		root.render(
			<ModelSelectorView
				open
				selectedModel={SELECTED_KEY}
				selectedOption={null}
				menuLevels={[]}
				groups={groups()}
				labels={LABELS}
				onModelSelect={() => undefined}
				onReasoningSelect={() => undefined}
			/>,
		);
	});
}

function mountedKeys(): string[] {
	return Array.from(document.querySelectorAll<HTMLElement>("[data-model-key]")).map(
		(element) => element.dataset.modelKey ?? "",
	);
}

function spacerHeight(): number {
	const rows = document.querySelectorAll<HTMLElement>("[data-model-key]");
	const first = rows[0]?.parentElement;
	const spacer = first?.querySelector<HTMLElement>("div[aria-hidden='true']");
	return Number.parseFloat(spacer?.style.height ?? "0");
}

function searchInput(): HTMLInputElement {
	const input = document.querySelector<HTMLInputElement>("input[type='search']");
	if (!input) throw new Error("missing search input");
	return input;
}

describe("模型选择菜单打开时的定位", () => {
	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		document.body.replaceChildren();
	});

	it("把当前模型定位到可视区顶部，即使它原本在窗口外", () => {
		renderView();

		// 修复前这里恒为 null：外部拿着一个从未挂到 DOM 的 ref 去 querySelector，
		// 而窗口化渲染下第 80 行根本没挂载。
		expect(mountedKeys()).toContain(SELECTED_KEY);

		// 「对齐到顶部」意味着上方留白正好是前 80 行的高度（窗口化 overscan 之外）。
		const expectedPaddingTop = (SELECTED_INDEX - 4) * ROW_HEIGHT;
		expect(spacerHeight()).toBeGreaterThanOrEqual(expectedPaddingTop);
		expect(spacerHeight()).toBeLessThan(SELECTED_INDEX * ROW_HEIGHT + 1);
	}, 20_000);

	it("搜索框按 ↓ 把焦点移到列表第一行，而不是被吞掉", () => {
		renderView();

		const input = searchInput();
		act(() => input.focus());
		expect(document.activeElement).toBe(input);

		act(() => {
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		});

		// 焦点真的进了列表：在此之前 ref 为空、target 恒为 undefined，等于没有这个快捷键。
		const focusedRow = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-model-key]");
		expect(focusedRow?.dataset.modelKey).toBe("primary/model-0");
	});

	it("没有匹配结果时按 ↓ 不吞掉按键", () => {
		renderView();

		const input = searchInput();
		act(() => {
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
			setter?.call(input, "no-such-model");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(document.querySelectorAll("[data-model-key]")).toHaveLength(0);

		const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
		act(() => {
			input.dispatchEvent(event);
		});
		// 被 preventDefault 却什么也不发生，比没有快捷键更糟。
		expect(event.defaultPrevented).toBe(false);
	});
});
