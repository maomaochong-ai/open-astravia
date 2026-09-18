// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { SidebarNavigation } from "@vetta-org/theme-ui/sidebar";
import type { SidebarNavItem } from "@vetta-org/theme-sdk/sidebar";
import { describe, expect, it } from "vitest";

/**
 * 侧栏导航指示条的合同：位置只走 CSS transform 直接落位，不做补间动画，
 * 更不允许回到逐帧写 left/top 的 JS 弹簧动画（低配机上每帧触发整条侧栏 layout）。
 */

const ITEMS: SidebarNavItem[] = [
	{ key: "/abilities", label: "能力", icon: "icon-[solar--widget-linear]", active: true, path: "/abilities" },
	{ key: "/scenes", label: "场景", icon: "icon-[solar--star-linear]", active: false, path: "/scenes" },
] as unknown as SidebarNavItem[];

function renderNav(bounds: { left: number; top: number; width: number; height: number } | null) {
	return render(
		<SidebarNavigation
			indicatorBounds={bounds}
			items={ITEMS}
			onItemClick={() => {}}
			setItemRef={() => () => {}}
		/>,
	);
}

function queryIndicator(container: HTMLElement): HTMLElement | null {
	return container.querySelector<HTMLElement>("[data-sidebar-nav-indicator]");
}

describe("SidebarNavigation 指示条", () => {
	it("无 bounds 时不渲染指示条", () => {
		const { container } = renderNav(null);
		expect(queryIndicator(container)).toBeNull();
	});

	it("位置走 transform + 宽高内联样式，而不是 left/top", () => {
		const { container } = renderNav({ left: 8, top: 24, width: 180, height: 32 });
		const indicator = queryIndicator(container);
		expect(indicator).not.toBeNull();
		expect(indicator?.style.transform).toBe("translate3d(8px, 24px, 0)");
		expect(indicator?.style.width).toBe("180px");
		expect(indicator?.style.height).toBe("32px");
		// left/top 不参与动画：固定为 0（由 class 提供），内联样式不写 left/top。
		expect(indicator?.style.left).toBe("");
		expect(indicator?.style.top).toBe("");
	});

	it("不声明任何过渡：切换导航项时指示条直接落位", () => {
		const { container } = renderNav({ left: 8, top: 24, width: 180, height: 32 });
		const indicator = queryIndicator(container);
		expect(indicator?.className).not.toContain("transition");
		expect(indicator?.style.transition).toBe("");
	});

	it("bounds 变化时更新 transform（直接落位，无 JS 动画帧）", () => {
		const { container, rerender } = renderNav({ left: 8, top: 24, width: 180, height: 32 });
		rerender(
			<SidebarNavigation
				indicatorBounds={{ left: 8, top: 60, width: 180, height: 32 }}
				items={ITEMS}
				onItemClick={() => {}}
				setItemRef={() => () => {}}
			/>,
		);
		const indicator = queryIndicator(container);
		expect(indicator?.style.transform).toBe("translate3d(8px, 60px, 0)");
	});
});
