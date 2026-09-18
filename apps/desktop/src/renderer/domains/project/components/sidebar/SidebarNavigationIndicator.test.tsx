// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { SidebarNavigation } from "@vetta-org/theme-ui/sidebar";
import type { SidebarNavItem } from "@vetta-org/theme-sdk/sidebar";
import { describe, expect, it, vi } from "vitest";

/**
 * 侧栏导航指示条的合同：纵向只走 CSS transform 直接落位，不做补间动画，更不允许
 * 回到逐帧写 left/top 的 JS 弹簧动画（低配机上每帧触发整条侧栏 layout）；横向必须由
 * CSS 拉伸，不能吃测量宽度——拖宽侧边栏时宽度不重渲染，测量值要等松手才追上。
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
	it("悬停或键盘聚焦只预取代码，点击仍按原入口导航", () => {
		const onItemIntent = vi.fn();
		const onItemClick = vi.fn();
		render(
			<SidebarNavigation
				indicatorBounds={null}
				items={ITEMS}
				onItemClick={onItemClick}
				onItemIntent={onItemIntent}
				setItemRef={() => () => {}}
			/>,
		);
		const scenes = screen.getByRole("button", { name: "场景" });
		fireEvent.mouseEnter(scenes);
		fireEvent.focus(scenes);
		expect(onItemIntent).toHaveBeenCalledWith(ITEMS[1]);
		expect(onItemClick).not.toHaveBeenCalled();
		fireEvent.click(scenes);
		expect(onItemClick).toHaveBeenCalledWith(ITEMS[1]);
	});

	it("更多菜单中的入口也在聚焦时预取，点击行为不变", () => {
		const moreItem = {
			key: "/knowledge", label: "知识库", icon: "icon-[solar--book-linear]", active: false, path: "/knowledge",
		} as SidebarNavItem;
		const onItemIntent = vi.fn();
		const onItemClick = vi.fn();
		render(
			<SidebarNavigation
				indicatorBounds={null}
				items={ITEMS}
				moreItems={[moreItem]}
				moreLabel="更多"
				moreOpen
				onItemClick={onItemClick}
				onItemIntent={onItemIntent}
				setItemRef={() => () => {}}
			/>,
		);
		const knowledge = screen.getByRole("button", { name: "知识库" });
		fireEvent.focus(knowledge);
		expect(onItemIntent).toHaveBeenCalledWith(moreItem);
		expect(onItemClick).not.toHaveBeenCalled();
		fireEvent.click(knowledge);
		expect(onItemClick).toHaveBeenCalledWith(moreItem);
	});

	it("无 bounds 时不渲染指示条", () => {
		const { container } = renderNav(null);
		expect(queryIndicator(container)).toBeNull();
	});

	it("纵向走 transform + 高度内联样式，而不是 left/top", () => {
		const { container } = renderNav({ left: 8, top: 24, width: 180, height: 32 });
		const indicator = queryIndicator(container);
		expect(indicator).not.toBeNull();
		expect(indicator?.style.transform).toBe("translate3d(0, 24px, 0)");
		expect(indicator?.style.height).toBe("32px");
		// left/top 不参与动画：固定为 0（由 class 提供），内联样式不写 left/top。
		expect(indicator?.style.left).toBe("");
		expect(indicator?.style.top).toBe("");
	});

	it("横向不吃测量宽度：由 inset-x 跟随侧栏实时宽度", () => {
		const { container } = renderNav({ left: 8, top: 24, width: 180, height: 32 });
		const indicator = queryIndicator(container);
		expect(indicator?.style.width).toBe("");
		expect(indicator?.className).toContain("inset-x-1.5");
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
		expect(indicator?.style.transform).toBe("translate3d(0, 60px, 0)");
	});
});
