// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import type { SidebarNavItem } from "@vetta/theme-sdk/sidebar";
import { SidebarNavigation } from "@vetta/theme-ui/sidebar";
import { describe, expect, it } from "vitest";

/**
 * 导航项图标的渲染合同：class 型图标按主题前景色着色，`iconUrl` 以原色 `<img>` 呈现。
 * `icon` 始终必填——不认识 `iconUrl` 的主题（含替换了 sidebar.navItem 的主题）要能回落。
 */

function item(overrides: Partial<SidebarNavItem>): SidebarNavItem {
	return {
		key: "workspace:chinese-chess/board",
		label: "象棋",
		icon: "vetta-plugin-nav-icon-1",
		active: false,
		type: "custom",
		...overrides,
	} as unknown as SidebarNavItem;
}

function renderNav(items: SidebarNavItem[], moreItems: SidebarNavItem[] = []) {
	return render(
		<SidebarNavigation
			indicatorBounds={null}
			items={items}
			moreItems={moreItems}
			moreLabel="更多"
			onItemClick={() => {}}
			setItemRef={() => () => {}}
		/>,
	);
}

function navButton(label: string): HTMLElement {
	return screen.getByRole("button", { name: new RegExp(label) });
}

describe("sidebar navigation icon", () => {
	it("renders a class-string icon as a tinted span", () => {
		renderNav([item({ icon: "icon-[solar--crown-linear]" })]);
		const button = navButton("象棋");
		expect(button.querySelector("img")).toBeNull();
		expect(button.querySelector("span.icon-\\[solar--crown-linear\\]")).not.toBeNull();
	});

	it("renders iconUrl as a full-color img instead of the tinted span", () => {
		renderNav([item({ iconUrl: "vetta-plugin://chinese-chess/assets/logo.png?v=1" })]);
		const image = within(navButton("象棋")).getByRole("presentation", { hidden: true });
		expect(image.tagName).toBe("IMG");
		expect(image.getAttribute("src")).toBe("vetta-plugin://chinese-chess/assets/logo.png?v=1");
		// A tinted mask class would repaint it with currentColor and destroy the colors.
		expect(image.className).not.toContain("vetta-plugin-nav-icon-1");
	});

	it("keeps the sizing classes on both shapes so the row does not shift", () => {
		const { unmount } = renderNav([item({})]);
		const span = navButton("象棋").querySelector("span.vetta-plugin-nav-icon-1");
		expect(span?.className).toContain("h-4");
		expect(span?.className).toContain("w-4");
		unmount();

		renderNav([item({ iconUrl: "vetta-plugin://p/logo.webp" })]);
		const image = within(navButton("象棋")).getByRole("presentation", { hidden: true });
		expect(image.className).toContain("h-4");
		expect(image.className).toContain("w-4");
		expect(image.className).toContain("object-contain");
	});

	it("uses the image for a collapsed entry that is the active route", () => {
		renderNav([], [item({ active: true, iconUrl: "vetta-plugin://p/logo.svg" })]);
		// The "more" trigger mirrors the active collapsed entry.
		const image = screen.getAllByRole("presentation", { hidden: true }).find((el) => el.tagName === "IMG");
		expect(image?.getAttribute("src")).toBe("vetta-plugin://p/logo.svg");
	});
});
