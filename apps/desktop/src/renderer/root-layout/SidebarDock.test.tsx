// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { SIDEBAR_DOCK_ANIMATION_MS, SidebarDock } from "@vetta-org/theme-ui/layout";
import { describe, expect, it } from "vitest";

/**
 * 侧边栏展开/收起的性能合同（真机实测支撑，见各条括注）：
 *
 * 1. **布局只落一次**：占位盒子的宽度直接切到终值、不参与过渡，面板用 transform 滑动。
 *    逐帧过渡宽度会让主内容区反复重排，而内容区里每个 ResizeObserver 都会在每个布局步上
 *    各触发一次——插件整页工作区视图全靠它做自适应，一次收缩实测 156 次回调、long task
 *    175ms；改成一步到位后是 26 次、long task 0。
 * 2. **过渡纯 CSS**，不走 JS 动画：展开这一下主线程最忙，逐帧写样式的动画第一个被挤掉。
 * 3. **收起不卸载子树**：整棵子树重挂一次是约 150ms 同步渲染，压在点击那一次 commit 里会
 *    把滑动的头几帧整段吃掉。
 * 4. 因此左栏节点常驻，收起态必须带 `inert` + `aria-hidden`：既挡掉指针与 Tab，也是
 *    「左栏不在位」的样式钩子（经典侧边栏贴边负 margin、主内容左缘补色都据它判定，
 *    见 renderer/styles.css）。
 *
 * 「子树确实没被卸载」「滑动确实不重排」这两条在 jsdom 里证不了（没有真实动画时钟与布局），
 * 证据来自真机测帧；这里钉住使之成立的结构与可达性约束。
 */

const WIDTH = 304;

function renderDock(visible: boolean) {
	return (
		<SidebarDock className="sidebar-dock" visible={visible} width={WIDTH}>
			<button type="button">会话列表</button>
		</SidebarDock>
	);
}

describe("SidebarDock", () => {
	it("从未展开过时占位节点常驻，但不挂载子树（启动即收起不该付这份代价）", () => {
		const { container } = render(renderDock(false));
		expect(container.querySelector(".sidebar-dock")).not.toBeNull();
		expect(screen.queryByText("会话列表")).toBeNull();
	});

	it("展开与收起之间复用同一个占位节点，不重建左栏", () => {
		const { container, rerender } = render(renderDock(true));
		const dock = container.firstElementChild;
		rerender(renderDock(false));
		expect(container.firstElementChild).toBe(dock);
		rerender(renderDock(true));
		expect(container.firstElementChild).toBe(dock);
	});

	it("占位宽度就是 committed 值（拖拽期由宿主直接改写这个元素，不进 React）", () => {
		const { container } = render(renderDock(true));
		const dock = container.firstElementChild as HTMLElement;
		// 拖宽度时宿主把实时宽度直接写到这个元素与面板上（见 useSidebarModel 的 resize）：
		// 内容区照常逐帧重排（实测满帧），而每帧 setWidth 会重渲染整条侧边栏与当前页面。
		expect(dock.style.width).toBe(`${WIDTH}px`);
	});

	it("布局宽度一步到位，滑动只用 transform（内容区因此只重排一次）", () => {
		const { container, rerender } = render(renderDock(true));
		const dock = container.firstElementChild as HTMLElement;
		const panel = dock.firstElementChild as HTMLElement;
		expect(dock.style.width).toBe(`${WIDTH}px`);
		expect(dock.style.transitionProperty).toBe("");
		expect(panel.className).toContain("transition-[transform,opacity]");
		expect(panel.style.transform).toBe("translateX(0)");

		rerender(renderDock(false));
		// 宽度瞬时归零；面板整体滑出，宽度不变。
		expect(dock.style.width).toBe("0px");
		expect(panel.style.width).toBe(`${WIDTH}px`);
		expect(panel.style.transform).toBe(`translateX(-${WIDTH}px)`);
		// 滑动时长与宿主的延迟挂载同源，所以写在 style 上而不是拍死成工具类。
		expect(panel.style.transitionDuration).toBe(`${SIDEBAR_DOCK_ANIMATION_MS}ms`);
	});

	it("收起态整块不绘制：面板右缘会压在窗口最左那 8px 上", () => {
		const { container, rerender } = render(renderDock(true));
		const panel = (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
		expect(panel.className).toContain("opacity-100");

		rerender(renderDock(false));
		// 占位盒子左缘停在 AppFrame 的 8px 内边距上，面板按自身宽度滑出后右缘正好落在
		// 窗口左缘；mac 经典侧边栏是半透明 tint + 右边框，不透明就会显成一条竖白条。
		expect(panel.className).toContain("opacity-0");
	});

	it("收起态对指针与辅助技术隐藏", () => {
		const { container, rerender } = render(renderDock(true));
		const dock = container.firstElementChild as HTMLElement;
		expect(dock.hasAttribute("inert")).toBe(false);
		expect(dock.getAttribute("aria-hidden")).toBeNull();

		rerender(renderDock(false));
		expect(dock.hasAttribute("inert")).toBe(true);
		expect(dock.getAttribute("aria-hidden")).toBe("true");
	});
});
