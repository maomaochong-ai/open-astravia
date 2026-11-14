import { describe, expect, it } from "vitest";
import { filterManageSessions, moveSelection, selectionAfterRemoval } from "./manage-sessions";

const items = [{ label: "重构标签页" }, { label: "SSH 主机探测" }, { label: "Refactor tabs" }];

/**
 * 「管理会话」靠搜索 + 键盘连续删除完成清理，因此过滤与选中项迁移的语义必须稳定：
 * 删掉一条之后选中项要停在原地附近，而不是跳回顶部。
 */
describe("管理会话：过滤", () => {
	it("空查询返回全部且不带高亮", () => {
		const matches = filterManageSessions(items, "   ");
		expect(matches).toHaveLength(3);
		expect(matches[0]?.ranges).toEqual([]);
	});

	it("不区分大小写地做子串匹配，并给出高亮区间", () => {
		const matches = filterManageSessions(items, "ssh");
		expect(matches).toHaveLength(1);
		expect(matches[0]?.ranges).toEqual([{ start: 0, end: 3 }]);
	});

	it("保持原有顺序（侧栏的置顶 / 时间序）", () => {
		const matched = filterManageSessions(items, "a").map((match) => match.item.label);
		expect(matched).toEqual(["Refactor tabs"]);
	});

	it("无命中时返回空数组", () => {
		expect(filterManageSessions(items, "zzz")).toEqual([]);
	});
});

describe("管理会话：选中项迁移", () => {
	it("删除后优先选同位置的下一条", () => {
		expect(selectionAfterRemoval(["a", "b", "c"], "b")).toBe("c");
	});

	it("删的是最后一条时退回上一条", () => {
		expect(selectionAfterRemoval(["a", "b"], "b")).toBe("a");
	});

	it("删光了返回 null，不留下悬空 id", () => {
		expect(selectionAfterRemoval(["a"], "a")).toBeNull();
	});

	it("方向键循环移动；当前不在列表里时从头/尾开始", () => {
		expect(moveSelection(["a", "b", "c"], "c", 1)).toBe("a");
		expect(moveSelection(["a", "b", "c"], "a", -1)).toBe("c");
		expect(moveSelection(["a", "b"], null, 1)).toBe("a");
		expect(moveSelection(["a", "b"], null, -1)).toBe("b");
		expect(moveSelection([], "a", 1)).toBeNull();
	});
});
