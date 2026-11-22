import { describe, expect, it } from "vitest";
import { createConnectedTabOutlineGeometry } from "./connected-tab-outline";

/**
 * 这些断言锁定「标签底部是圆弧、并与面板上边框在同一条线上」这件事。
 *
 * 参数不是随手取的，它们与三处实现互相约束：
 * - 标签按钮高 32（`h-8`），面板上边框 1px，所以描边收尾必须落在 32.5（边框中心）；
 * - 行左内边距 = 面板左上圆角 + 连接角外伸，弧线末端才落在面板直线的起点上；
 * - 填充要比描边再深一点，整条 1px 上边框被盖住，否则会从标签中间穿过去。
 */
const TAB_HEIGHT = 32;
const BORDER_CENTER = TAB_HEIGHT + 0.5;
const RADIUS = 6;

function numbers(path: string): number[] {
	return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe("createConnectedTabOutlineGeometry", () => {
	const geometry = createConnectedTabOutlineGeometry(120);

	it("starts and ends on the panel border's centre line", () => {
		const outline = numbers(geometry.outlinePath);
		// 首段 "M 0 32.5"：起点贴在面板上边框中心
		expect(outline[1]).toBe(BORDER_CENTER);
		// 末段 "... A r r 0 0 0 <x> 32.5"：右侧同样收在中心线上
		expect(outline.at(-1)).toBe(BORDER_CENTER);
	});

	it("draws the bottom corners as concave arcs, not square corners", () => {
		// 四段圆弧：首段是 "M ..." 起点，所以 split 后为 5 段。
		// 若退化成方角，这里只会剩起点与折线，分段数远小于此值。
		const arcSegments = geometry.outlinePath.split(" A ").slice(1);
		expect(arcSegments).toHaveLength(4);
		// 底部两段的 sweep 为 0（向内凹），顶部为 1
		expect(geometry.outlinePath).toContain(`A ${RADIUS} ${RADIUS} 0 0 0 ${RADIUS}`);
		expect(geometry.outlinePath).toContain(`A ${RADIUS} ${RADIUS} 0 0 1 ${RADIUS + RADIUS}`);
	});

	it("extends the fill past the outline so the panel border is covered", () => {
		const [fillY] = [numbers(geometry.fillPath)[1]];
		expect(fillY).toBe(BORDER_CENTER);
		expect(geometry.height).toBeGreaterThan(BORDER_CENTER);
		expect(geometry.height - BORDER_CENTER).toBeGreaterThanOrEqual(1);
		// 填充路径必须闭合，否则盖不住
		expect(geometry.fillPath.endsWith("Z")).toBe(true);
	});

	it("reserves exactly JOIN_RADIUS on each side, matching the row inset contract", () => {
		// width = 页签宽度 + 左右各外伸一点；offsetX 就是外伸量。
		// 行左内边距取「面板圆角 6 + 本值」，弧线末端才落在面板直线的起点上。
		expect(geometry.offsetX).toBe(RADIUS);
		expect(geometry.width).toBe(120 + RADIUS * 2);
	});

	it("clamps very narrow tabs so the two top radii cannot overlap", () => {
		const narrow = createConnectedTabOutlineGeometry(4);
		expect(narrow.width).toBe(RADIUS * 2 + RADIUS * 2);
	});
});
