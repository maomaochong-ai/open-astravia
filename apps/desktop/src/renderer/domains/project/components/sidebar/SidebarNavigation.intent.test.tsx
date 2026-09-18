// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { SidebarNavItem } from "@vetta-org/theme-sdk/sidebar";
import { SidebarNavigation } from "@vetta-org/theme-ui/sidebar";
import { describe, expect, it, vi } from "vitest";

const ITEMS: SidebarNavItem[] = [
	{ key: "/abilities", label: "能力", icon: "icon-[solar--widget-linear]", active: false, path: "/abilities" },
] as unknown as SidebarNavItem[];

describe("SidebarNavigation 意图预取", () => {
	it("指针进入导航项时触发 onItemIntent", () => {
		const onItemIntent = vi.fn();
		render(
			<SidebarNavigation
				indicatorBounds={null}
				items={ITEMS}
				onItemClick={() => {}}
				onItemIntent={onItemIntent}
				setItemRef={() => () => {}}
			/>,
		);
		fireEvent.mouseEnter(screen.getByRole("button", { name: /能力/ }));
		expect(onItemIntent).toHaveBeenCalledTimes(1);
		expect(onItemIntent.mock.calls[0]?.[0]).toMatchObject({ path: "/abilities" });
	});
});
