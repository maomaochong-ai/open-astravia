// @vitest-environment jsdom

import { TodoStatusBarView, type TodoStatusItem } from "@vetta/theme-ui/chat";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const LABELS = {
	trigger: "待办",
	allDone: "全部完成",
	panelTitle: "待办清单",
	openPanel: "在面板中打开",
	statusDone: "已完成",
	statusInProgress: "进行中",
	statusPending: "待办",
};

const ITEMS: TodoStatusItem[] = [
	{ id: 1, content: "完成数学题一", status: "done" },
	{ id: 2, content: "完成数学题二", status: "in_progress" },
	{ id: 3, content: "完成数学题三", status: "pending" },
];

function render(items: readonly TodoStatusItem[], onOpenPanel?: () => void) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(createElement(TodoStatusBarView, { items, labels: LABELS, onOpenPanel }));
	});
	return {
		container,
		trigger: () => container.querySelector<HTMLButtonElement>("button[aria-label='待办']"),
		cleanup: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

describe("TodoStatusBarView", () => {
	it("shows progress and the in-progress item on the trigger", () => {
		const view = render(ITEMS);
		const trigger = view.trigger();
		expect(trigger?.textContent).toContain("1/3");
		expect(trigger?.textContent).toContain("完成数学题二");
		view.cleanup();
	});

	it("falls back to the all-done label once every item is done", () => {
		const view = render(ITEMS.map((item) => ({ ...item, status: "done" as const })));
		expect(view.trigger()?.textContent).toContain("3/3");
		expect(view.trigger()?.textContent).toContain("全部完成");
		view.cleanup();
	});

	it("renders nothing without todos", () => {
		const view = render([]);
		expect(view.container.textContent).toBe("");
		view.cleanup();
	});

	it("opens a popover listing every item and can jump to the activity panel", () => {
		const onOpenPanel = vi.fn();
		const view = render(ITEMS, onOpenPanel);
		act(() => {
			view.trigger()?.click();
		});

		const popover = document.querySelector("[data-radix-popper-content-wrapper]") ?? document.body;
		for (const item of ITEMS) {
			expect(popover.textContent).toContain(item.content);
		}
		expect(popover.textContent).toContain("待办清单");

		const openPanelButton = Array.from(popover.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("在面板中打开"),
		);
		act(() => {
			openPanelButton?.click();
		});
		expect(onOpenPanel).toHaveBeenCalledOnce();
		view.cleanup();
	});
});
