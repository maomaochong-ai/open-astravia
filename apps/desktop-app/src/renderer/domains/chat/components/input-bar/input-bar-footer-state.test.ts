import { describe, expect, it } from "vitest";
import {
	type InputBarFooterSlotEvent,
	type InputBarFooterSlotState,
	initialInputBarFooterSlotState,
	reduceInputBarFooterSlot,
} from "./input-bar-footer-state";

function run(state: InputBarFooterSlotState, ...events: InputBarFooterSlotEvent[]): InputBarFooterSlotState {
	return events.reduce(reduceInputBarFooterSlot, state);
}

const closed = initialInputBarFooterSlotState(false);

describe("inputBarFooterSlot", () => {
	it("首帧就有内容时直接是展开态，不播入场动画", () => {
		expect(initialInputBarFooterSlotState(true)).toEqual({ mounted: true, expanded: true });
		expect(closed).toEqual({ mounted: false, expanded: false });
	});

	it("入场先以收起态挂载，下一帧才展开（否则没有过渡起点）", () => {
		const mounting = run(closed, { type: "open" });
		expect(mounting).toEqual({ mounted: true, expanded: false });
		expect(run(mounting, { type: "enter-frame" })).toEqual({ mounted: true, expanded: true });
	});

	it("退场期间内容仍挂载，过渡结束才卸载", () => {
		const open = run(closed, { type: "open" }, { type: "enter-frame" });
		const leaving = run(open, { type: "close" });
		expect(leaving).toEqual({ mounted: true, expanded: false });
		expect(run(leaving, { type: "exit-end" })).toEqual({ mounted: false, expanded: false });
	});

	it("退场途中重新打开直接回到展开态，不再卸载", () => {
		const leaving = run(closed, { type: "open" }, { type: "enter-frame" }, { type: "close" });
		const reopened = run(leaving, { type: "open" });
		expect(reopened).toEqual({ mounted: true, expanded: true });
		// 上一轮遗留的退场计时器即便迟到，也不能把刚回来的内容摘掉。
		expect(run(reopened, { type: "exit-end" })).toEqual({ mounted: true, expanded: true });
	});

	it("未挂载时的 close / enter-frame 是空操作", () => {
		expect(run(closed, { type: "close" })).toBe(closed);
		expect(run(closed, { type: "enter-frame" })).toBe(closed);
		expect(run(closed, { type: "exit-end" })).toEqual(closed);
	});
});
