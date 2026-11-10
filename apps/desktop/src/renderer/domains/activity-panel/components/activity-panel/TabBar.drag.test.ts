// @vitest-environment jsdom

import { TabBar } from "@shared/components/ui/tab-bar";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("motion/react", () => ({ motion: { span: () => null } }));

class ResizeObserverStub {
	disconnect(): void {}
	observe(): void {}
}

const capturedPointers = new WeakMap<Element, Set<number>>();

function pointerEvent(type: string, x: number, y: number, pointerId = 1): MouseEvent {
	const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
	Object.defineProperty(event, "pointerId", { value: pointerId });
	return event;
}

function fileDragEvent(type: string): Event {
	const event = new Event(type, { bubbles: true });
	Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"] } });
	return event;
}

function bounds(left: number, top: number, width: number, height: number): DOMRect {
	return {
		bottom: top + height,
		height,
		left,
		right: left + width,
		top,
		width,
		x: left,
		y: top,
		toJSON: () => ({}),
	};
}

function setTabBounds(container: HTMLElement): void {
	const row = container.querySelector<HTMLElement>("[data-tabkey]")?.parentElement;
	if (!row) throw new Error("tab row not found");
	row.getBoundingClientRect = () => bounds(0, 0, 300, 30);
	for (const [index, tab] of Array.from(row.children).entries()) {
		(tab as HTMLElement).getBoundingClientRect = () => bounds(index * 100, 0, 100, 30);
	}
}

describe("TabBar pointer drag", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		vi.stubGlobal("ResizeObserver", ResizeObserverStub);
		Object.defineProperties(HTMLElement.prototype, {
			setPointerCapture: {
				configurable: true,
				value(pointerId: number): void {
					const pointers = capturedPointers.get(this) ?? new Set<number>();
					pointers.add(pointerId);
					capturedPointers.set(this, pointers);
				},
			},
			hasPointerCapture: {
				configurable: true,
				value(pointerId: number): boolean {
					return capturedPointers.get(this)?.has(pointerId) ?? false;
				},
			},
			releasePointerCapture: {
				configurable: true,
				value(pointerId: number): void {
					capturedPointers.get(this)?.delete(pointerId);
				},
			},
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		document.querySelector<HTMLElement>("[data-tab-drag-overlay]")?.remove();
	});

	/*
	 * 选中的页签与下方内容面板连成一体：顶部圆角 + 两侧三边描边 + 底部凹形连接角。
	 *
	 * 填充与描边来自同一条几何（connected-tab-outline），所以连接角不可能与竖线错开；
	 * 描边叠 `vector-effect="non-scaling-stroke"`，页面缩放时线宽恒为 1px 而不会被拉细。
	 */
	it("draws the selected tab outline as one fill plus one stroke path", () => {
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
			...bounds(0, 0, 120, 32),
			toJSON: () => ({}),
		} as DOMRect);
		vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120);
		// 几何宽度由 ResizeObserver 报上来；默认 stub 不回调用例里永远拿不到 path。
		vi.stubGlobal(
			"ResizeObserver",
			class {
				private readonly callback: ResizeObserverCallback;
				constructor(callback: ResizeObserverCallback) {
					this.callback = callback;
				}
				observe(): void {
					this.callback(
						[{ contentRect: { width: 120 } } as ResizeObserverEntry],
						this as unknown as ResizeObserver,
					);
				}
				disconnect(): void {}
			},
		);
		const render = (removable: boolean): void => {
			act(() => {
				root.render(
					createElement(TabBar, {
						items: [
							{ key: "a", label: "A", removable },
							{ key: "b", label: "B" },
						],
						value: "a",
						onChange: vi.fn(),
						...(removable ? { onRemove: vi.fn(), removeLabel: "close" } : {}),
						suppressLayoutAnimation: true,
					}),
				);
			});
		};

		try {
			render(false);
			const indicator = container.querySelector("[data-active-tab-indicator]");
			expect(indicator).not.toBeNull();
			// 指示器盖住按钮的 1px 透明边框，否则轮廓整体下移一像素压到卡片内容上。
			expect(indicator?.className).toContain("-inset-x-px");
			expect(indicator?.className).toContain("-top-px");

			const svg = indicator?.querySelector("svg[data-connected-tab-outline]");
			expect(svg).not.toBeNull();
			const paths = [...(svg?.querySelectorAll("path") ?? [])];
			// 一条填充 + 一条描边，共用同一份几何。
			expect(paths).toHaveLength(2);
			expect(paths[0]?.getAttribute("stroke")).toBe("none");
			expect(paths[0]?.getAttribute("d")).toContain("Z");
			const stroke = paths[1];
			expect(stroke?.getAttribute("fill")).toBe("none");
			expect(stroke?.getAttribute("stroke-width")).toBe("1");
			expect(stroke?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
			const d = stroke?.getAttribute("d") ?? "";
			// 两端都是凹形连接角（sweep=0），收尾落在卡片描边中心。
			expect(d.startsWith("M 0 34 A 8 8 0 0 0 8 26")).toBe(true);

			// 未选中的页签不画轮廓。
			expect(container.querySelectorAll("[data-active-tab-indicator]")).toHaveLength(1);

			// 可关闭的页签同样成立（关闭按钮不参与轮廓）。
			render(true);
			expect(container.querySelector("[data-connected-tab-outline]")).not.toBeNull();
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("keeps a click below the drag threshold", () => {
		const onChange = vi.fn();
		const onDragStart = vi.fn();
		act(() => {
			root.render(
				createElement(TabBar, {
					items: [{ key: "a", label: "A" }],
					value: "a",
					onChange,
					onReorder: vi.fn(),
					onTabDragStart: onDragStart,
				}),
			);
		});
		setTabBounds(container);
		const tab = container.querySelector<HTMLElement>('[data-tabkey="a"]');
		const button = tab?.querySelector("button");
		if (!tab || !button) throw new Error("tab not found");
		act(() => {
			tab.dispatchEvent(pointerEvent("pointerdown", 10, 10));
			expect(capturedPointers.get(tab)?.size ?? 0).toBe(0);
			tab.dispatchEvent(pointerEvent("pointermove", 12, 11));
			tab.dispatchEvent(pointerEvent("pointerup", 12, 11));
			button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledOnce();
		expect(onDragStart).not.toHaveBeenCalled();
		expect(document.querySelector("[data-tab-drag-overlay]")).toBeNull();
	});

	it("activates a tab after a file drag hovers over it", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		act(() => {
			root.render(
				createElement(TabBar, {
					items: [
						{ key: "a", label: "A" },
						{ key: "b", label: "B" },
					],
					value: "a",
					onChange,
					activateOnFileDragHover: true,
				}),
			);
		});
		const tab = container.querySelector<HTMLElement>('[data-tabkey="b"]');
		if (!tab) throw new Error("tab not found");

		act(() => tab.dispatchEvent(fileDragEvent("dragenter")));
		expect(tab.hasAttribute("data-file-drag-hover")).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(300));
		expect(onChange).toHaveBeenCalledWith("b");
	});

	it("keeps the close action inside the active tab", () => {
		const onChange = vi.fn();
		const onRemove = vi.fn();
		act(() => {
			root.render(
				createElement(TabBar, {
					items: [
						{ key: "a", label: "A" },
						{ key: "b", label: "B", removable: true },
					],
					value: "b",
					onChange,
					onRemove,
					removeLabel: "Hide tab",
				}),
			);
		});
		const close = container.querySelector<HTMLButtonElement>('button[aria-label="Hide tab: B"]');
		if (!close) throw new Error("close button not found");

		act(() => close.click());
		expect(onRemove).toHaveBeenCalledWith("b");
		expect(onChange).not.toHaveBeenCalled();
	});

	it("continues dragging after the source tab is removed", () => {
		const onDragEnd = vi.fn();
		function Harness(): ReturnType<typeof createElement> {
			const [items, setItems] = useState([
				{ key: "a", label: "A" },
				{ key: "b", label: "B" },
			]);
			return createElement(TabBar, {
				items,
				value: items[0]?.key ?? "b",
				onChange: vi.fn(),
				onReorder: vi.fn(),
				onTabDragMove: (event) => {
					if (event.point.y > 60) setItems((current) => current.filter((item) => item.key !== event.key));
				},
				onTabDragEnd: onDragEnd,
			});
		}
		act(() => root.render(createElement(Harness)));
		setTabBounds(container);
		const tab = container.querySelector<HTMLElement>('[data-tabkey="a"]');
		if (!tab) throw new Error("tab not found");
		act(() => {
			tab.dispatchEvent(pointerEvent("pointerdown", 10, 10));
			tab.dispatchEvent(pointerEvent("pointermove", 20, 10));
		});
		const overlay = document.querySelector<HTMLElement>("[data-tab-drag-overlay]");
		if (!overlay) throw new Error("drag overlay not found");
		act(() => overlay.dispatchEvent(pointerEvent("pointermove", 120, 100)));
		expect(container.querySelector('[data-tabkey="a"]')).toBeNull();
		act(() => overlay.dispatchEvent(pointerEvent("pointerup", 120, 100)));
		expect(onDragEnd).toHaveBeenCalledWith(
			expect.objectContaining({ cancelled: false, key: "a", point: { x: 120, y: 100 } }),
		);
		expect(document.querySelector("[data-tab-drag-overlay]")).toBeNull();
	});

	it("cancels reordered state on Escape", () => {
		const onReorder = vi.fn();
		const onDragEnd = vi.fn();
		act(() => {
			root.render(
				createElement(TabBar, {
					items: [
						{ key: "a", label: "A" },
						{ key: "b", label: "B" },
					],
					value: "a",
					onChange: vi.fn(),
					onReorder,
					onTabDragEnd: onDragEnd,
				}),
			);
		});
		setTabBounds(container);
		const tab = container.querySelector<HTMLElement>('[data-tabkey="a"]');
		if (!tab) throw new Error("tab not found");
		act(() => {
			tab.dispatchEvent(pointerEvent("pointerdown", 10, 10));
			tab.dispatchEvent(pointerEvent("pointermove", 20, 10));
		});
		const overlay = document.querySelector<HTMLElement>("[data-tab-drag-overlay]");
		if (!overlay) throw new Error("drag overlay not found");
		act(() => {
			overlay.dispatchEvent(pointerEvent("pointermove", 250, 10));
			document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
		});
		expect(onReorder).not.toHaveBeenCalled();
		expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true, key: "a" }));
		expect(document.querySelector("[data-tab-drag-overlay]")).toBeNull();
	});

	it("lets the host take over a detached drag without committing tab order", () => {
		const onReorder = vi.fn();
		act(() => {
			root.render(
				createElement(TabBar, {
					items: [
						{ key: "a", label: "A" },
						{ key: "b", label: "B" },
					],
					value: "a",
					onChange: vi.fn(),
					onReorder,
					onTabDragEnd: () => false,
				}),
			);
		});
		setTabBounds(container);
		const tab = container.querySelector<HTMLElement>('[data-tabkey="a"]');
		if (!tab) throw new Error("tab not found");
		act(() => {
			tab.dispatchEvent(pointerEvent("pointerdown", 10, 10));
			tab.dispatchEvent(pointerEvent("pointermove", 20, 10));
		});
		const overlay = document.querySelector<HTMLElement>("[data-tab-drag-overlay]");
		if (!overlay) throw new Error("drag overlay not found");
		act(() => {
			overlay.dispatchEvent(pointerEvent("pointermove", 250, 10));
			overlay.dispatchEvent(pointerEvent("pointerup", 250, 10));
		});
		expect(onReorder).not.toHaveBeenCalled();
	});
});
