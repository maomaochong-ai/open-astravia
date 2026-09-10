import { describe, expect, it } from "vitest";
import { OPTIONS_ROW_STACK_WIDTH } from "./constants";
import { shouldStackProjectSelector } from "./options-row-layout";

describe("shouldStackProjectSelector", () => {
	it("插槽窄于阈值时把项目选择器挪到输入框下方", () => {
		expect(shouldStackProjectSelector(OPTIONS_ROW_STACK_WIDTH - 1)).toBe(true);
	});

	it("插槽刚好够宽时三枚 chip 留在同一行", () => {
		expect(shouldStackProjectSelector(OPTIONS_ROW_STACK_WIDTH)).toBe(false);
		expect(shouldStackProjectSelector(OPTIONS_ROW_STACK_WIDTH + 200)).toBe(false);
	});

	it("尚未测量时按宽版渲染，不先猜一个位置", () => {
		expect(shouldStackProjectSelector(null)).toBe(false);
	});
});
