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
	favoritesEmpty: "还没有收藏的模型",
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

function renderView(extra: Partial<React.ComponentProps<typeof ModelSelectorView>> = {}): void {
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
				{...extra}
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

/**
 * 面板外观与底栏位置：这两处都曾是「看着像对齐了、实际没有」的地方。
 *
 * 圆角那条尤其隐蔽——`PopoverContent` 用 `asChild` 时，Radix 的 Slot 只把 className 拼接到
 * 内层元素上（不经 tailwind-merge 去重），于是 `rounded-2xl` 与 `rounded-[inherit]` 落在同一个
 * 元素上，`inherit` 从 portal 容器继承到 0，面板就变成直角。这里锁的是「带底色的那层自己持有
 * 圆角」，改回 asChild 会立刻变红。
 */
describe("模型选择面板的外观与底栏", () => {
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

	it("面板自己持有圆角，玻璃底色与背景模糊都在同一层", () => {
		renderView();

		const surface = document.querySelector<HTMLElement>("[data-slot='popover-content']");
		expect(surface).not.toBeNull();
		expect(surface?.className).toContain("rounded-2xl");
		expect(surface?.className).toContain("bg-background/40");
		expect(surface?.className).toContain("backdrop-blur-2xl");
		// 不自绘描边与硬阴影：深色边界交给基础浮层的极淡描边。
		expect(surface?.className).not.toContain("shadow-xl");
		expect(surface?.className).not.toContain("dark:border");
		// 圆角不能被 inherit 覆盖成 0。
		expect(surface?.className).not.toContain("rounded-[inherit]");
	});

	it("底栏左侧放快捷键提示、右侧放权限模式", () => {
		renderView({
			footerStart: <span data-testid="hint">⌘P</span>,
			footerEnd: <button type="button" data-testid="mode">沙箱</button>,
		});

		const footer = document.querySelector<HTMLElement>("[data-model-selector-footer]");
		expect(footer).not.toBeNull();
		const [left, right] = Array.from(footer?.children ?? []);
		expect(left?.querySelector("[data-testid='hint']")).not.toBeNull();
		expect(right?.querySelector("[data-testid='mode']")).not.toBeNull();
		// 权限模式贴在右侧：左格吃掉剩余宽度，右格不缩。
		expect(left?.className).toContain("min-w-0");
		expect(right?.className).toContain("shrink-0");
	});

	it("没有底栏插槽时整条底栏不渲染", () => {
		renderView();
		expect(document.querySelector("[data-model-selector-footer]")).toBeNull();
	});
});
