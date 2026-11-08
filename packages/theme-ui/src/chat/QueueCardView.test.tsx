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
	guide: "guide",
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
			onGuide={() => undefined}
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

	it("puts the guide action immediately left of recall, and omits both on a compaction barrier", () => {
		// 引导是对「这条消息」的动作，必须贴着撤回，而不是另起一个工具栏按钮。
		act(() => mount([{ id: "q1", displayText: "first queued message" }]));

		const guide = buttonByLabel(LABELS.guide);
		expect(guide.nextElementSibling).toBe(buttonByLabel(LABELS.recall));

		act(() => mount([{ id: "c1", displayText: "compaction", kind: "context_compaction" }]));
		expect(container.querySelector(`button[aria-label="${LABELS.guide}"]`)).toBeNull();
		expect(container.querySelector(`button[aria-label="${LABELS.recall}"]`)).toBeNull();
	});

	it("hides guide behind a compaction barrier instead of leaving a button that does nothing", () => {
		// 屏障之后的条目被插进当前回合会绕过它建立的顺序，内核也会以 missing 回绝；
		// 所以引导与「立即发送」用同一道闸，宁可不出按钮。
		act(() => mount([{ id: "q1", displayText: "blocked", canSendNow: false }]));

		expect(container.querySelector(`button[aria-label="${LABELS.guide}"]`)).toBeNull();
	});

	it("keeps the three row actions on one spacing rhythm", () => {
		// 间距只由行容器的 gap 提供：三个图标按钮的盒模型类名必须一致，
		// 没有哪个自带 margin/padding 把自己推开。颜色属于各自语义，不比。
		act(() => mount([{ id: "q1", displayText: "first queued message" }]));

		const shells = [LABELS.guide, LABELS.recall, LABELS.delete].map((label) =>
			buttonByLabel(label)
				.className.split(/\s+/)
				.filter((token) => !token.startsWith("hover:"))
				.sort()
				.join(" "),
		);

		expect(new Set(shells).size).toBe(1);
		for (const shell of shells) {
			expect(shell).not.toMatch(/\b-?[mp][trblxy]?-/);
		}
	});
});
