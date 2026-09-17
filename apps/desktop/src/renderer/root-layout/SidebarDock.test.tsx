// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { SidebarDock } from "@vetta-org/theme-ui/layout";
import { describe, expect, it } from "vitest";

/**
 * 侧边栏展开/收起的性能合同：
 *
 * 1. 过渡是纯 CSS（`grid-template-columns` 0fr↔1fr），不允许回到 JS 动画——展开这一下
 *    主线程最忙，逐帧测量并写样式的动画第一个被挤掉。
 * 2. 收起不卸载子树：整棵子树重挂载一次是约 150ms 同步渲染，压在点击那一次 commit 里会把
 *    过渡的头几帧整段吃掉（真机实测 47 帧掉到 36-40 帧、最大帧间隔 99ms）。
 * 3. 因此左栏节点常驻，收起态必须带 `inert` + `aria-hidden`：既挡掉指针与 Tab，也是
 *    「左栏不在位」的样式钩子（经典侧边栏贴边的负 margin、主内容左缘补色都据它判定，
 *    见 renderer/styles.css）。
 *
 * 「收起后子树确实没被卸载」这条在 jsdom 里证不了：过渡结束事件依赖真实动画时钟，卸载与
 * 不卸载的结果一样。它的证据来自真机测帧（每次展开 47-48 帧 / long task 0），这里只钉住
 * 使之成立的结构与可达性约束。
 */

function renderDock(visible: boolean) {
	return (
		<SidebarDock className="sidebar-dock" visible={visible}>
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

	it("宽度过渡走 CSS 轨道，不用 JS 动画逐帧写样式", () => {
		const { container, rerender } = render(renderDock(true));
		const dock = container.firstElementChild as HTMLElement;
		expect(dock.className).toContain("transition-[grid-template-columns,opacity,margin-left]");
		expect(dock.className).toContain("grid-cols-[1fr]");

		rerender(renderDock(false));
		expect(dock.className).toContain("grid-cols-[0fr]");
		// 过渡时长与宿主的延迟挂载同源，所以写在 style 上而不是拍死成工具类。
		expect(dock.style.transitionDuration).toBe("240ms");
	});

	it("收起态对指针与辅助技术隐藏，展开态恢复溢出以承载浮层", () => {
		const { container, rerender } = render(renderDock(true));
		const dock = container.firstElementChild as HTMLElement;
		expect(dock.hasAttribute("inert")).toBe(false);
		expect(dock.getAttribute("aria-hidden")).toBeNull();
		expect((dock.firstElementChild as HTMLElement).className).toContain("overflow-visible");

		rerender(renderDock(false));
		expect(dock.hasAttribute("inert")).toBe(true);
		expect(dock.getAttribute("aria-hidden")).toBe("true");
		expect((dock.firstElementChild as HTMLElement).className).toContain("overflow-hidden");
	});
});
