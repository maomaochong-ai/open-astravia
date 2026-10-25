// @vitest-environment jsdom
import { CompactionStepView } from "@astravia-org/theme-ui/chat/CompactionStepView";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

/**
 * 摘要框是固定高度、可内部滚动的。流式时新文本落在框底，
 * 不跟着滚就只能看到旧内容，而用户滑的轮子滚的是外层会话——两边就不同步。
 */
function mountSummary(summary: string) {
	const view = render(<CompactionStepView status="running" label="Compacting context…" summary={summary} />);
	const box = document.querySelector<HTMLDivElement>("[data-compaction-summary]");
	if (!box) throw new Error("summary box is missing");
	let scrollTop = 0;
	Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 1000 });
	Object.defineProperty(box, "clientHeight", { configurable: true, get: () => 200 });
	Object.defineProperty(box, "scrollTop", {
		configurable: true,
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value;
		},
	});
	return {
		box,
		scrollTop: () => scrollTop,
		rerender: (next: string) =>
			view.rerender(<CompactionStepView status="running" label="Compacting context…" summary={next} />),
	};
}

describe("CompactionStepView streamed summary", () => {
	it("keeps the newest summary line visible while the summary grows", () => {
		const summary = mountSummary("## 已完成的工作\n\n- 第一条");

		act(() => summary.rerender("## 已完成的工作\n\n- 第一条\n- 第一条之后又写了很长一段"));

		expect(summary.scrollTop()).toBe(1000);
	});

	it("stops pulling the box down once the reader scrolls up inside it", () => {
		const summary = mountSummary("## 已完成的工作\n\n- 第一条");
		act(() => summary.rerender("## 已完成的工作\n\n- 第一条\n- 第二条"));

		// 用户自己往上翻：退出跟随。
		Object.defineProperty(summary.box, "scrollTop", {
			configurable: true,
			get: () => 100,
			set: () => {},
		});
		fireEvent.scroll(summary.box);

		act(() => summary.rerender("## 已完成的工作\n\n- 第一条\n- 第二条\n- 第三条"));

		expect(summary.box.scrollTop).toBe(100);
		// 面板本身仍然开着，用户接着看同一段摘要。
		expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
	});
});
