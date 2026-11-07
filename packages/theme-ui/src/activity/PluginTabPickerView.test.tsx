// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginTabPickerView, type TabPickerEntryView } from "./PluginTabPickerView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels = {
	menu: "Open tab menu",
	moreTabs: "More tabs",
	hiddenPanels: "Hidden panels",
	availablePanels: "Available panels",
};

let root: Root | null = null;

function mount(ui: React.ReactElement): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(ui);
	});
	return container;
}

function entry(key: string, label: string): TabPickerEntryView {
	return { key, label };
}

async function openMenu(container: HTMLElement): Promise<void> {
	const trigger = container.querySelector("button");
	expect(trigger).not.toBeNull();
	await act(async () => {
		trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	});
}

function findButtonByText(text: string): HTMLButtonElement | undefined {
	return Array.from(document.querySelectorAll("button")).find((candidate) =>
		candidate.textContent?.includes(text),
	);
}

describe("PluginTabPickerView", () => {
	afterEach(() => {
		act(() => {
			root?.unmount();
		});
		root = null;
		document.body.innerHTML = "";
	});

	it("安装的插件面板变多时，展开后的列表自身可滚动", async () => {
		const availableTabs = Array.from({ length: 30 }, (_, index) =>
			entry(`plugin-${index}`, `Plugin panel ${index}`),
		);

		const container = mount(
			<PluginTabPickerView
				hiddenTabs={[]}
				onRestore={() => {}}
				overflowTabs={[]}
				onSelectOverflow={() => {}}
				availableTabs={availableTabs}
				onAttachTab={() => {}}
				labels={labels}
			/>,
		);

		await openMenu(container);

		const sectionTitle = Array.from(document.querySelectorAll("div")).find(
			(node) => node.textContent === labels.availablePanels,
		);
		expect(sectionTitle).toBeDefined();

		const scroller = sectionTitle?.closest("[data-radix-popper-content-wrapper]")
			? sectionTitle.parentElement
			: sectionTitle?.parentElement;
		// 面板列表容器必须限定高度并允许纵向滚动，否则插件多到超出视口就切换不动了。
		expect(scroller?.className).toContain("overflow-y-auto");
		expect(scroller?.className).toContain("max-h-");
		expect(scroller?.querySelectorAll("button").length).toBe(availableTabs.length);
	});

	it("从菜单里添加面板、切到收纳页签或恢复隐藏页签都会回传对应的 key", async () => {
		const onAttachTab = vi.fn();
		const onSelectOverflow = vi.fn();
		const onRestore = vi.fn();

		const container = mount(
			<PluginTabPickerView
				hiddenTabs={[entry("debug", "Debug")]}
				onRestore={onRestore}
				overflowTabs={[entry("ports", "Ports")]}
				onSelectOverflow={onSelectOverflow}
				availableTabs={[entry("browser", "Browser")]}
				onAttachTab={onAttachTab}
				labels={labels}
			/>,
		);

		await openMenu(container);

		await act(async () => {
			findButtonByText("Browser")?.dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		expect(onAttachTab).toHaveBeenCalledWith("browser");

		await openMenu(container);
		await act(async () => {
			findButtonByText("Ports")?.dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		expect(onSelectOverflow).toHaveBeenCalledWith("ports");

		await openMenu(container);
		await act(async () => {
			findButtonByText("Debug")?.dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		expect(onRestore).toHaveBeenCalledWith("debug");
	});

	it("有收纳页签时按钮显示数量，只有可添加面板时显示加号图标", () => {
		const withOverflow = mount(
			<PluginTabPickerView
				hiddenTabs={[]}
				onRestore={() => {}}
				overflowTabs={[entry("a", "A"), entry("b", "B")]}
				onSelectOverflow={() => {}}
				labels={labels}
			/>,
		);
		expect(withOverflow.querySelector("button")?.textContent).toContain("2");

		act(() => {
			root?.unmount();
		});
		root = null;
		document.body.innerHTML = "";

		const withAvailable = mount(
			<PluginTabPickerView
				hiddenTabs={[]}
				onRestore={() => {}}
				overflowTabs={[]}
				onSelectOverflow={() => {}}
				availableTabs={[entry("browser", "Browser")]}
				onAttachTab={() => {}}
				labels={labels}
			/>,
		);
		expect(withAvailable.querySelector("button")?.innerHTML).toContain(
			"icon-[solar--add-circle-linear]",
		);
	});
});
