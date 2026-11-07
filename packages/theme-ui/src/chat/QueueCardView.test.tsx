// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueCardView, type QueueCardViewLabels } from "./QueueCardView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS: QueueCardViewLabels = {
	empty: "empty",
	sendNow: "send-now",
	delete: "delete",
	recall: "recall",
};

let container: HTMLDivElement;
let root: Root;

function mount(items: Parameters<typeof QueueCardView>[0]["items"]) {
	root.render(
		<QueueCardView
			items={items}
			labels={LABELS}
			onReorder={() => undefined}
			onSendNow={() => undefined}
			onRemove={() => undefined}
			onRecall={() => undefined}
		/>,
	);
}

function buttonByLabel(label: string): HTMLButtonElement {
	const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
	if (!found) throw new Error(`missing button ${label}`);
	return found;
}

describe("QueueCardView", () => {
	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("keeps recall and delete visible without hovering the row", () => {
		// 这两个操作原先只在 hover 时显形，触屏与「找不到撤回按钮」的反馈都指向这里。
		act(() => mount([{ id: "q1", displayText: "first queued message" }]));

		for (const label of [LABELS.recall, LABELS.delete]) {
			const button = buttonByLabel(label);
			expect(button.className).not.toContain("opacity-0");
			expect(button.className).not.toContain("group-hover:opacity-100");
		}
	});
});
