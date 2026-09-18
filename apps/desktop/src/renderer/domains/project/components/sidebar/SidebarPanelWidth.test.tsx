// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { SidebarPanel } from "@vetta-org/theme-ui/sidebar";
import { describe, expect, it } from "vitest";

/**
 * 拖宽度的性能合同：实时宽度只写面板这一个元素，不进 React、也不挂成 `:root` 上的自定义属性。
 *
 * 三条路在长会话页实测过（40 次改宽的总耗时）：每帧 setWidth → 整条侧边栏与当前页面重渲染；
 * 写 `:root` 自定义属性 → 2945ms（继承属性变化会让整篇文档样式失效重算）；写面板元素的
 * style.width → 622ms。所以模型走 setPanelRef 直接写，见 useSidebarModel 的 resize。
 */

function renderPanel(width: number, panelRef?: (element: HTMLDivElement | null) => void) {
	return (
		<SidebarPanel onResize={() => {}} onResizeEnd={() => {}} panelRef={panelRef} width={width}>
			<div>侧边栏内容</div>
		</SidebarPanel>
	);
}

describe("SidebarPanel 宽度", () => {
	it("把根节点交给 panelRef，宽度取 committed 值", () => {
		const seen: HTMLDivElement[] = [];
		const { container } = render(
			renderPanel(304, (node) => {
				if (node) seen.push(node);
			}),
		);
		expect(seen[0]).toBe(container.firstElementChild);
		expect(seen[0]?.style.width).toBe("304px");
	});

	it("committed 值不变时重渲染不覆盖拖拽期写进去的宽度", () => {
		// 引用要跨重渲染保持：ref 回调本身必须稳定，否则 React 会先解绑再绑。
		const seen: HTMLDivElement[] = [];
		const keep = (node: HTMLDivElement | null): void => {
			if (node) seen.push(node);
		};
		const { rerender } = render(renderPanel(304, keep));
		const panel = seen[0] as HTMLDivElement;

		// 模拟拖拽：只写 DOM，不碰 state。
		panel.style.width = "380px";
		rerender(renderPanel(304, keep));
		expect(panel.style.width).toBe("380px");

		// 松手提交：committed 值变了，React 才写回。
		rerender(renderPanel(360, keep));
		expect(panel.style.width).toBe("360px");
	});
});
