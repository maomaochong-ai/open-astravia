// @vitest-environment jsdom

import { TabBar } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import { createStore, Provider } from "jotai";
import { act, createElement, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFloatingActivityTabs } from "./useFloatingActivityTabs";

vi.mock("motion/react", () => ({ motion: { span: () => null } }));

const ActivityTabBar = TabBar<ActivityTabKey>;

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

function Harness(): ReturnType<typeof createElement> {
	const [active, setActive] = useState<ActivityTabKey>("file");
	const [order, setOrder] = useState<ActivityTabKey[]>(["file", "browser"]);
	const mainTabListRef = useRef<HTMLDivElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const floating = useFloatingActivityTabs({
		allTabKeys: order,
		mainTabListRef,
		onActiveTabChange: setActive,
		onTabOrderChange: setOrder,
		panelRef,
		panelWidth: 360,
		scopeKey: "project-a",
	});
	const dockedItems = useMemo(
		() => order.filter((key) => !floating.model.floatingKeys.has(key)).map((key) => ({ key, label: key })),
		[order, floating.model.floatingKeys],
	);

	return createElement(
		"div",
		{ "data-harness": "" },
		createElement(
			"div",
			{ ref: panelRef, "data-panel": "" },
			createElement(ActivityTabBar, {
				items: dockedItems,
				listRef: mainTabListRef,
				value: active,
				onChange: setActive,
				onReorder: setOrder,
				onTabDragStart: floating.actions.onDockedTabDragStart,
				onTabDragMove: floating.actions.onDockedTabDragMove,
				onTabDragEnd: floating.actions.onDockedTabDragEnd,
			}),
		),
		...floating.model.floatingTabs.map((placement) =>
			createElement(
				"div",
				{ key: placement.key, "data-floating-harness": placement.key },
				createElement(ActivityTabBar, {
					items: [{ key: placement.key, label: placement.key }],
					value: placement.key,
					onChange: floating.actions.onFloatingTabFocus,
					onTabDragStart: floating.actions.onFloatingTabDragStart,
					onTabDragMove: floating.actions.onFloatingTabDragMove,
					onTabDragEnd: floating.actions.onFloatingTabDragEnd,
				}),
			),
		),
		createElement("output", { "data-active": active, "data-order": order.join(",") }),
	);
}

describe("useFloatingActivityTabs", () => {
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
		act(() => root.render(createElement(Provider, { store: createStore() }, createElement(Harness))));
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		document.querySelector<HTMLElement>("[data-tab-drag-overlay]")?.remove();
	});

	it("detaches one tab and docks it back at the pointer position", () => {
		const panel = container.querySelector<HTMLElement>("[data-panel]");
		const mainFile = container.querySelector<HTMLElement>('[data-panel] [data-tabkey="file"]');
		const mainRow = mainFile?.parentElement;
		if (!panel || !mainFile || !mainRow) throw new Error("main tab bar not found");
		panel.getBoundingClientRect = () => bounds(640, 30, 360, 700);
		mainRow.getBoundingClientRect = () => bounds(640, 0, 360, 30);
		for (const [index, tab] of Array.from(mainRow.children).entries()) {
			(tab as HTMLElement).getBoundingClientRect = () => bounds(640 + index * 100, 0, 100, 30);
		}

		act(() => {
			mainFile.dispatchEvent(pointerEvent("pointerdown", 680, 10));
			mainFile.dispatchEvent(pointerEvent("pointermove", 690, 10));
		});
		let overlay = document.querySelector<HTMLElement>("[data-tab-drag-overlay]");
		if (!overlay) throw new Error("drag overlay not found");
		const dockedDragOverlay = overlay;
		act(() => dockedDragOverlay.dispatchEvent(pointerEvent("pointermove", 500, 100)));
		expect(container.querySelector('[data-panel] [data-tabkey="file"]')).toBeNull();
		expect(container.querySelector('[data-floating-harness="file"]')).not.toBeNull();
		act(() => dockedDragOverlay.dispatchEvent(pointerEvent("pointerup", 500, 100)));

		const floatingFile = container.querySelector<HTMLElement>('[data-floating-harness="file"] [data-tabkey="file"]');
		const floatingRow = floatingFile?.parentElement;
		if (!floatingFile || !floatingRow) throw new Error("floating tab not found");
		floatingRow.getBoundingClientRect = () => bounds(420, 80, 360, 30);
		floatingFile.getBoundingClientRect = () => bounds(420, 80, 100, 30);
		act(() => {
			floatingFile.dispatchEvent(pointerEvent("pointerdown", 460, 90));
			floatingFile.dispatchEvent(pointerEvent("pointermove", 470, 90));
		});
		overlay = document.querySelector<HTMLElement>("[data-tab-drag-overlay]");
		if (!overlay) throw new Error("floating drag overlay not found");
		act(() => {
			overlay.dispatchEvent(pointerEvent("pointermove", 660, 10));
			overlay.dispatchEvent(pointerEvent("pointerup", 660, 10));
		});

		expect(container.querySelector('[data-floating-harness="file"]')).toBeNull();
		expect(container.querySelector('[data-panel] [data-tabkey="file"]')).not.toBeNull();
		const output = container.querySelector("output");
		expect(output?.dataset.active).toBe("file");
		expect(output?.dataset.order).toBe("file,browser");
	});
});
