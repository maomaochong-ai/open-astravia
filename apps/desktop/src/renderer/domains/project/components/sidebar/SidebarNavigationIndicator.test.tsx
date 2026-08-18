// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { SidebarNavigation } from "@vetta/theme-ui/sidebar";
import type { SidebarNavItem } from "@vetta/theme-sdk/sidebar";
import { describe, expect, it } from "vitest";

/**
 * 侧栏导航指示条的性能合同：位置动画必须由 CSS transform 过渡承担（合成器友好），
 * 不允许回到逐帧写 left/top 的 JS 弹簧动画（低配机上每帧触发整条侧栏 layout）。
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

	it("声明了具体属性的 CSS 过渡并尊重 reduce-motion", () => {
		const { container } = renderNav({ left: 8, top: 24, width: 180, height: 32 });
		const indicator = queryIndicator(container);
		expect(indicator?.className).toContain("transition-[transform,width,height]");
		expect(indicator?.className).toContain("motion-reduce:transition-none");
	});

	it("bounds 变化时更新 transform（由 CSS 过渡插值，无 JS 动画帧）", () => {
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
