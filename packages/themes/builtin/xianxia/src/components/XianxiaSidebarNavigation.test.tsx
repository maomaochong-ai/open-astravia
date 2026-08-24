import { cleanup, render, screen } from "@testing-library/react";
import type { SidebarNavigationProps } from "@vetta/desktop-theme-ui/sidebar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { XianxiaSidebarNavigation } from "./XianxiaSidebarNavigation";

vi.mock("@vetta/theme-sdk/pages", () => ({
	useThemePagesModel: () => ({
		actions: { openPage: vi.fn() },
		navItems: [
			{
				active: false,
				icon: "icon-[solar--stars-linear]",
				key: "/theme/xianxia/sanctum",
				label: "Sanctum",
				pageId: "sanctum",
			},
		],
	}),
}));

vi.mock("@vetta/desktop-theme-ui/sidebar", () => ({
	SidebarNavigation: ({ indicatorBounds, items, setItemRef }: SidebarNavigationProps) => (
		<nav data-indicator-top={indicatorBounds?.top ?? "unset"}>
			{items.map((item, index) => (
				<button key={item.key} ref={setItemRef(index)} type="button">
					{item.label}
				</button>
			))}
		</nav>
	),
}));

afterEach(() => cleanup());

describe("XianxiaSidebarNavigation", () => {
	it("主题页模型返回等价的新数组时不会循环更新指示条", () => {
		const activeItem = {
			active: true,
			icon: "icon-[solar--home-linear]",
			key: "home",
			label: "Home",
			type: "custom" as const,
		};

		expect(() =>
			render(
				<XianxiaSidebarNavigation
					indicatorBounds={null}
					items={[activeItem]}
					onItemClick={vi.fn()}
					setItemRef={() => () => {}}
				/>,
			),
		).not.toThrow();
		expect(screen.getByRole("navigation").getAttribute("data-indicator-top")).toBe("0");
	});
});
