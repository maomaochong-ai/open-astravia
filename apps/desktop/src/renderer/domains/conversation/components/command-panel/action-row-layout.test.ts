import { describe, expect, it } from "vitest";
import { INLINE_ACTION_COUNT, splitActionRow } from "./action-row-layout";

function action(id: string, active = false) {
	return { id, active };
}

describe("splitActionRow", () => {
	it("默认平铺 2 个", () => {
		expect(INLINE_ACTION_COUNT).toBe(2);
	});

	it("不超过 2 个时全部平铺，没有「更多」", () => {
		for (const count of [0, 1, 2]) {
			const layout = splitActionRow(Array.from({ length: count }, (_, index) => action(`a${index}`)));
			expect(layout.inline).toHaveLength(count);
			expect(layout.overflow).toHaveLength(0);
			expect(layout.hasOverflow).toBe(false);
			expect(layout.hiddenActiveCount).toBe(0);
		}
	});

	it("超过 2 个时只平铺前 2 个，其余进「更多」", () => {
		const layout = splitActionRow([action("a"), action("b"), action("c"), action("d")]);
		expect(layout.inline.map(({ id }) => id)).toEqual(["a", "b"]);
		expect(layout.overflow.map(({ id }) => id)).toEqual(["c", "d"]);
		expect(layout.hasOverflow).toBe(true);
	});

	// 收起不等于关掉：菜单里的动作仍生效，触发钮要能看出「里面还有开着的」。
	it("统计收起的动作里已激活的数量", () => {
		const layout = splitActionRow([action("a", true), action("b"), action("c", true), action("d", true)]);
		expect(layout.hiddenActiveCount).toBe(2);
	});

	it("平铺区的激活状态不计入隐藏数量", () => {
		const layout = splitActionRow([action("a", true), action("b", true), action("c")]);
		expect(layout.hiddenActiveCount).toBe(0);
	});
});
