// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityPanelFocusAtom } from "@shared/store/activity-atoms";
import { useActivityTabMaximize } from "./useActivityTabMaximize";

function setRowWidth(element: HTMLElement, width: number): void {
	Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
}

function Harness(): JSX.Element {
	const ref = useRef<HTMLDivElement | null>(null);
	const model = useActivityTabMaximize(ref);
	return (
		<div data-testid="row">
			<div ref={ref} data-testid="panel" data-width={model.width} data-maximized={model.isMaximized} />
			<button type="button" onClick={model.toggle}>
				toggle
			</button>
		</div>
	);
}

describe("useActivityTabMaximize", () => {
	let container: HTMLDivElement;
	let root: Root;
	let resizeCallbacks: Array<() => void>;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		resizeCallbacks = [];
		// 面板靠内容行的实测宽度铺满；jsdom 没有布局，这里给出可变的宽度。
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
			constructor(callback: () => void) {
				resizeCallbacks.push(callback);
			}
			observe(): void {}
			disconnect(): void {}
		};
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
	});

	it("铺满时按内容行宽度展开，再点一次回到原状", () => {
		act(() => root.render(<Harness />));
		const row = container.querySelector('[data-testid="row"]');
		const panel = container.querySelector('[data-testid="panel"]') as HTMLElement | null;
		if (!row || !panel) throw new Error("harness did not render");
		setRowWidth(row as HTMLElement, 1280);

		expect(panel.dataset.maximized).toBe("false");
		expect(panel.dataset.width).toBe("0");

		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.maximized).toBe("true");
		expect(panel.dataset.width).toBe("1280");

		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.maximized).toBe("false");
		expect(panel.dataset.width).toBe("0");
	});

	it("窗口或侧边栏变化时重新取行宽，不把面板留在旧尺寸上", () => {
		act(() => root.render(<Harness />));
		const row = container.querySelector('[data-testid="row"]') as HTMLElement;
		const panel = container.querySelector('[data-testid="panel"]') as HTMLElement;
		setRowWidth(row, 1280);
		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.width).toBe("1280");

		setRowWidth(row, 960);
		act(() => {
			for (const callback of resizeCallbacks) callback();
		});
		expect(panel.dataset.width).toBe("960");
	});

	// 面板是行里的最后一个子列，前面还有一道 flex 间隙。只把行宽写给面板时，这段间隙
	// 会留在面板左侧，铺满后左边一条缝、右边贴边。铺满期间把行内间隙收掉，宽度就
	// 等于整行宽度；退出时还原行内联样式，消息列的间距不受影响。
	it("铺满时收掉行内 flex 间隙，面板贴满整行，退出后还原", () => {
		const original = window.getComputedStyle.bind(window);
		const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
			const style = original(element, pseudo);
			return element instanceof HTMLElement && element.dataset.testid === "row"
				? ({ ...style, columnGap: "8px" } as CSSStyleDeclaration)
				: style;
		});
		try {
			act(() => root.render(<Harness />));
			const row = container.querySelector('[data-testid="row"]') as HTMLElement;
			const panel = container.querySelector('[data-testid="panel"]') as HTMLElement;
			setRowWidth(row, 1280);

			act(() => {
				(container.querySelector("button") as HTMLButtonElement).click();
			});
			expect(row.style.columnGap).toBe("0px");
			expect(panel.dataset.width).toBe("1280");

			act(() => {
				(container.querySelector("button") as HTMLButtonElement).click();
			});
			expect(row.style.columnGap).toBe("");
		} finally {
			spy.mockRestore();
		}
	});

	// 铺满会同时收起宿主侧边栏与全局顶栏，那两处由根布局渲染；只有共享同一份状态，
	// 「面板铺满」和「外壳让位」才会同时发生，所以这里锁住跨消费方的一致性。
	it("铺满状态是共享的，卸载即退出", () => {
		act(() => root.render(<Harness />));
		const row = container.querySelector('[data-testid="row"]') as HTMLElement;
		const panel = container.querySelector('[data-testid="panel"]') as HTMLElement;
		setRowWidth(row, 1280);

		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.maximized).toBe("true");
		expect(getDefaultStore().get(activityPanelFocusAtom)).toBe(true);

		act(() => root.unmount());
		expect(getDefaultStore().get(activityPanelFocusAtom)).toBe(false);
	});

	it("Esc 退出铺满", () => {
		act(() => root.render(<Harness />));
		const row = container.querySelector('[data-testid="row"]') as HTMLElement;
		const panel = container.querySelector('[data-testid="panel"]') as HTMLElement;
		setRowWidth(row, 1280);
		act(() => {
			(container.querySelector("button") as HTMLButtonElement).click();
		});
		expect(panel.dataset.maximized).toBe("true");

		act(() => {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(panel.dataset.maximized).toBe("false");
	});

	// 铺满是把面板这一列撑到行宽（从右往左收上去），不是把宿主窗口推进全屏。
	// 整窗全屏归窗口自己的最大化控件；两者绑定过一次，用户点了“进入全屏”
	// 结果整个应用进全屏、侧边栏和标题栏全没，窗口尺寸也不受自己控。
	it("铺满不去动宿主窗口的全屏状态", () => {
		const toggleFullScreen = vi.fn(async () => true);
		(window as unknown as { astravia?: unknown }).astravia = {
			window: {
				isFullScreen: async () => false,
				toggleFullScreen,
				onFullScreenChanged: () => () => {},
			},
		};
		try {
			act(() => root.render(<Harness />));
			const row = container.querySelector('[data-testid="row"]') as HTMLElement;
			setRowWidth(row, 1280);
			act(() => {
				(container.querySelector("button") as HTMLButtonElement).click();
			});
			act(() => {
				(container.querySelector("button") as HTMLButtonElement).click();
			});
			expect(toggleFullScreen).not.toHaveBeenCalled();
		} finally {
			delete (window as unknown as { astravia?: unknown }).astravia;
		}
	});
});
