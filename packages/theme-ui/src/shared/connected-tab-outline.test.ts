import { describe, expect, it } from "vitest";
import { createConnectedTabOutlineGeometry } from "./connected-tab-outline";

describe("createConnectedTabOutlineGeometry", () => {
	it("creates one continuous outline around the tab and both join curves", () => {
		expect(createConnectedTabOutlineGeometry(72)).toEqual({
			fillPath:
				"M 0 32 A 8 8 0 0 0 8 24 V 8 A 8 8 0 0 1 16 0 H 72 A 8 8 0 0 1 80 8 V 24 A 8 8 0 0 0 88 32 V 33 H 0 Z",
			height: 33,
			offsetX: 8,
			outlinePath: "M 0 32.5 A 8 8 0 0 0 8 24 V 8 A 8 8 0 0 1 16 0 H 72 A 8 8 0 0 1 80 8 V 24 A 8 8 0 0 0 88 32.5",
			width: 88,
		});
	});

	it("keeps radii valid when the measured tab is narrower than both top corners", () => {
		const geometry = createConnectedTabOutlineGeometry(10);

		expect(geometry.width).toBe(32);
		expect(geometry.outlinePath).toContain("H 16 A 8 8 0 0 1 24 8");
	});

	it("lands both shoulders on the frame border's stroke center, not its top edge", () => {
		const geometry = createConnectedTabOutlineGeometry(72);
		// 卡片顶边描边占 y ∈ [32, 33]，线心 32.5。肩线基线与描边线心等值，
		// 1px 描边才正好压满那一格；从 32 起笔会留下半像素接缝。
		expect(geometry.outlinePath.startsWith("M 0 32.5")).toBe(true);
		expect(geometry.outlinePath.endsWith("88 32.5")).toBe(true);
		expect(geometry.height).toBe(33);
	});

	it("erases the whole frame border row so no stub sticks out under the shoulders", () => {
		const geometry = createConnectedTabOutlineGeometry(72);
		// 擦除轮廓仍从卡片顶边上沿（32）起笔并闭合到 33，覆盖整格 [32, 33]；
		// 若跟着描边一起抬到 32.5，肩线下方会漏出半像素的卡片描边。
		expect(geometry.fillPath.startsWith("M 0 32 A 8 8")).toBe(true);
		expect(geometry.fillPath.endsWith("V 33 H 0 Z")).toBe(true);
	});
});
