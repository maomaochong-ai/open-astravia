// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuggestionBubblesView } from "./SuggestionBubblesView";

/**
 * 预测气泡的两条路径必须都在：
 * - 点条目本体 = 直接发送（原有快捷路径，不能丢）；
 * - 悬停浮出的「编辑」= 填进输入框再改（新加，避免只差几个字也要重打）。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: ReactElement): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(ui);
	});
	return container;
}

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.replaceChildren();
});

function renderView(suggestions: readonly string[] = ["总结一下这次改动"]) {
	const onSend = vi.fn();
	const onEdit = vi.fn();
	const container = mount(
		<SuggestionBubblesView
			suggestions={suggestions}
			sendTooltip="发送"
			editTooltip="编辑"
			onSend={onSend}
			onEdit={onEdit}
		/>,
	);
	return { container, onSend, onEdit };
}

function clickByText(container: HTMLElement, text: string): void {
	const target = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
	if (!target) throw new Error(`button not found: ${text}`);
	act(() => {
		target.click();
	});
}

describe("SuggestionBubblesView", () => {
	it("点条目本体直接发送", () => {
		const { container, onSend } = renderView();
		clickByText(container, "总结一下这次改动");
		expect(onSend).toHaveBeenCalledWith("总结一下这次改动");
	});

	it("悬停动作里有「发送」与「编辑」两个入口", () => {
		const { container, onSend, onEdit } = renderView();

		const actionLabels = [...container.querySelectorAll("button[aria-label]")].map((button) =>
			button.getAttribute("aria-label"),
		);
		expect(actionLabels).toEqual(["发送", "编辑"]);

		const sendButton = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "发送");
		const editButton = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "编辑");
		act(() => sendButton?.click());
		act(() => editButton?.click());
		expect(onSend).toHaveBeenCalledWith("总结一下这次改动");
		expect(onEdit).toHaveBeenCalledWith("总结一下这次改动");
	});

	it("没有建议时不渲染条目", () => {
		const html = renderToStaticMarkup(
			<SuggestionBubblesView suggestions={[]} sendTooltip="发送" editTooltip="编辑" onSend={vi.fn()} onEdit={vi.fn()} />,
		);
		expect(html).not.toContain("<button");
	});
});
