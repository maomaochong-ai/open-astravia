// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeferredSurface } from "./DeferredSurface";
import {
	deferredSurfacePhase,
	deferredSurfaceRootClassName,
	keepAliveShouldStackLeave,
	shouldStartStackLeave,
} from "./deferred-surface-display";

async function flushAnimationFrame(): Promise<void> {
	await act(async () => {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	});
}

function surfaceRoots(container: HTMLElement): HTMLElement[] {
	return [...container.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
}

describe("deferredSurfacePhase", () => {
	it("入场可见、叠层离场、最终 hidden", () => {
		expect(deferredSurfacePhase({ active: true, leaving: false })).toBe("visible");
		expect(deferredSurfacePhase({ active: true, leaving: true })).toBe("visible");
		expect(deferredSurfacePhase({ active: false, leaving: true })).toBe("leaving");
		expect(deferredSurfacePhase({ active: false, leaving: false })).toBe("hidden");
	});

	it("只有从可见切走才开始叠层", () => {
		expect(shouldStartStackLeave(false, true, true)).toBe(true);
		expect(shouldStartStackLeave(false, true, false)).toBe(false);
		expect(shouldStartStackLeave(false, false, true)).toBe(false);
		expect(keepAliveShouldStackLeave(true)).toBe(false);
		expect(keepAliveShouldStackLeave(false)).toBe(true);
		expect(shouldStartStackLeave(true, true, true)).toBe(false);
	});

	it("离场 class 不占 flex-1", () => {
		expect(deferredSurfaceRootClassName("visible")).toContain("flex-1");
		expect(deferredSurfaceRootClassName("leaving")).toContain("absolute");
		expect(deferredSurfaceRootClassName("leaving")).not.toContain("flex-1");
		expect(deferredSurfaceRootClassName("hidden")).not.toContain("flex-1");
	});
});

describe("DeferredSurface", () => {
	it("从未打开过时不预挂载", () => {
		const { container } = render(
			<DeferredSurface active={false} name="settings">
				<p>body</p>
			</DeferredSurface>,
		);
		expect(container.textContent).not.toContain("body");
	});

	it("切走后隐藏但仍保留同一棵树，切回不重建", () => {
		const { container, rerender } = render(
			<DeferredSurface active name="settings">
				<p>body</p>
			</DeferredSurface>,
		);
		const first = container.querySelector("p");
		expect(first?.textContent).toBe("body");

		rerender(
			<DeferredSurface active={false} name="settings">
				<p>body</p>
			</DeferredSurface>,
		);
		const hidden = container.querySelector("p");
		expect(hidden).toBe(first);
		expect(hidden?.closest("[hidden]")).not.toBeNull();

		rerender(
			<DeferredSurface active name="settings">
				<p>body</p>
			</DeferredSurface>,
		);
		expect(container.querySelector("p")).toBe(first);
		expect(container.querySelector("[hidden]")).toBeNull();
	});

	it("premount 时即使还没走进也挂隐藏树", () => {
		const { container } = render(
			<DeferredSurface active={false} premount name="gallery">
				<p>body</p>
			</DeferredSurface>,
		);
		expect(container.textContent).toContain("body");
		expect(container.querySelector("[hidden]")).not.toBeNull();
	});

	it("隐藏时标记 inert 并暂停 CSS 动画，避免后台页抢帧", () => {
		const { container, rerender } = render(
			<DeferredSurface active name="gallery">
				<p>body</p>
			</DeferredSurface>,
		);
		rerender(
			<DeferredSurface active={false} name="gallery">
				<p>body</p>
			</DeferredSurface>,
		);
		const hidden = container.querySelector("[hidden]");
		expect(hidden).not.toBeNull();
		expect(hidden?.hasAttribute("inert")).toBe(true);
		expect(hidden?.className).toContain("animation-play-state:paused");
		// `[hidden]` 已经是 display:none；再叠 content-visibility:hidden，切回时会多一次整树实现布局。
		expect((hidden as HTMLElement).style.contentVisibility).not.toBe("hidden");
	});

	it("未开 stackLeave 时（设置标签）切走立刻 hidden，不叠层", () => {
		const { container, rerender } = render(
			<DeferredSurface active name="settings-tab:models">
				<p>models-body</p>
			</DeferredSurface>,
		);
		rerender(
			<DeferredSurface active={false} name="settings-tab:models">
				<p>models-body</p>
			</DeferredSurface>,
		);
		const root = surfaceRoots(container)[0];
		expect(root?.hidden).toBe(true);
		expect(root?.className).toBe(deferredSurfaceRootClassName("hidden"));
		expect(root?.className).not.toContain("absolute");
		expect(container.textContent).toContain("models-body");
	});

	it("stackLeave 切走后第一帧脱离 flex，下一帧才 hidden", async () => {
		const { container, rerender } = render(
			<DeferredSurface active name="chat" stackLeave>
				<p>body</p>
			</DeferredSurface>,
		);
		const first = container.querySelector("p");

		rerender(
			<DeferredSurface active={false} name="chat" stackLeave>
				<p>body</p>
			</DeferredSurface>,
		);
		const leaving = surfaceRoots(container)[0];
		expect(leaving).toBeTruthy();
		expect(leaving?.hidden).toBe(false);
		expect(leaving?.className).toBe(deferredSurfaceRootClassName("leaving"));
		expect(leaving?.className).not.toContain("flex-1");
		expect(leaving?.hasAttribute("inert")).toBe(true);
		expect(container.textContent).toContain("body");
		expect(container.querySelector("p")).toBe(first);

		await flushAnimationFrame();
		const hidden = surfaceRoots(container)[0];
		expect(hidden?.hidden).toBe(true);
		expect(hidden?.className).toBe(deferredSurfaceRootClassName("hidden"));
		expect(container.querySelector("p")).toBe(first);
	});

	it("stackLeave 预挂的从未走进页第一帧就是 hidden，不叠层", () => {
		const { container } = render(
			<DeferredSurface active={false} premount stackLeave name="abilities">
				<p>abilities-body</p>
			</DeferredSurface>,
		);
		const root = surfaceRoots(container)[0];
		expect(container.textContent).toContain("abilities-body");
		expect(root?.hidden).toBe(true);
		expect(root?.className).not.toContain("absolute");
		expect(root?.className).not.toContain("flex-1");
	});

	it("侧栏从 A 切到 B 时入场立刻占 flex-1，离场不抢 flex 槽", async () => {
		function Stage({ current }: { current: "chat" | "settings" }) {
			return (
				<>
					<DeferredSurface active={current === "chat"} name="chat" stackLeave>
						<p>chat-body</p>
					</DeferredSurface>
					<DeferredSurface active={current === "settings"} name="settings" stackLeave>
						<p>settings-body</p>
					</DeferredSurface>
				</>
			);
		}

		const { container, rerender } = render(<Stage current="chat" />);
		expect(container.textContent).toContain("chat-body");
		expect(container.textContent).not.toContain("settings-body");

		rerender(<Stage current="settings" />);
		const roots = surfaceRoots(container);
		const flexSlots = roots.filter((node) => node.className.includes("flex-1"));
		expect(flexSlots).toHaveLength(1);
		expect(flexSlots[0]?.textContent).toContain("settings-body");
		expect(flexSlots[0]?.hidden).toBe(false);

		const outgoing = roots.find((node) => node.textContent?.includes("chat-body"));
		expect(outgoing?.className).toBe(deferredSurfaceRootClassName("leaving"));
		expect(outgoing?.hidden).toBe(false);
		expect(container.textContent).toContain("chat-body");
		expect(container.textContent).toContain("settings-body");

		await flushAnimationFrame();
		expect(outgoing?.hidden).toBe(true);
		expect(outgoing?.closest("[hidden]")).toBe(outgoing);
		expect(flexSlots[0]?.hidden).toBe(false);
		expect(surfaceRoots(container).filter((node) => node.className.includes("flex-1"))).toHaveLength(1);
	});
});
