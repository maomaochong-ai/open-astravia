// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { ProjectSessionsView } from "@vetta/theme-ui/project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 项目组展开/折叠的性能合同：动画由纯 CSS grid-template-rows 过渡承担，
 * 不允许回到 motion 的 height:auto 动画（每帧 JS 测量 + 写高度）。
 * 折叠时内容延迟卸载，让 CSS 过渡播完；播完后必须真正卸载以释放 DOM。
 */

const SESSIONS = [
	{ key: "s1", active: false },
	{ key: "s2", active: false },
];

function renderView(expanded: boolean) {
	return (
		<ProjectSessionsView
			empty={<div>empty</div>}
			expanded={expanded}
			hasMore={false}
			labels={{ collapse: "收起", expand: "展开" }}
			onToggleShowAll={() => {}}
			scrollParent={null}
			sessions={SESSIONS}
			showAll={false}
			renderSession={(session) => (
				<button key={session.key} type="button">
					会话 {session.key}
				</button>
			)}
		/>
	);
}

describe("ProjectSessionsView 展开/折叠", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("展开时渲染会话行，容器为 1fr 且可见", () => {
		const { container } = render(renderView(true));
		expect(screen.getByText("会话 s1")).toBeTruthy();
		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper.style.gridTemplateRows).toBe("1fr");
		expect(wrapper.getAttribute("aria-hidden")).toBe("false");
	});

	it("折叠瞬间内容仍挂载（供 CSS 过渡播放），容器切到 0fr 并对辅助技术隐藏", () => {
		const { container, rerender } = render(renderView(true));
		rerender(renderView(false));
		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper.style.gridTemplateRows).toBe("0fr");
		expect(wrapper.getAttribute("aria-hidden")).toBe("true");
		expect(screen.queryByText("会话 s1")).not.toBeNull();
	});

	it("折叠过渡结束后真正卸载内容，释放 DOM", () => {
		const { rerender } = render(renderView(true));
		rerender(renderView(false));
		act(() => {
			vi.advanceTimersByTime(300);
		});
		expect(screen.queryByText("会话 s1")).toBeNull();
	});

	it("折叠中途重新展开会取消卸载", () => {
		const { rerender } = render(renderView(true));
		rerender(renderView(false));
		act(() => {
			vi.advanceTimersByTime(100);
		});
		rerender(renderView(true));
		act(() => {
			vi.advanceTimersByTime(300);
		});
		expect(screen.queryByText("会话 s1")).not.toBeNull();
	});

	it("初始即折叠时不渲染任何会话行", () => {
		render(renderView(false));
		expect(screen.queryByText("会话 s1")).toBeNull();
	});

	it("动画声明为具体属性的 CSS 过渡并尊重 reduce-motion", () => {
		const { container } = render(renderView(true));
		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper.className).toContain("transition-[grid-template-rows,opacity]");
		expect(wrapper.className).toContain("motion-reduce:transition-none");
	});
});
