import { describe, expect, it } from "vitest";
import {
	DATABASE_LAYOUT_DETAILS_BREAKPOINT,
	DATABASE_LAYOUT_TREE_BREAKPOINT,
	resolveDatabaseLayout,
} from "./database-layout";

describe("resolveDatabaseLayout", () => {
	it("narrow: 树与详情均不自动显示（单栏）", () => {
		for (const width of [0, 1, 259, DATABASE_LAYOUT_TREE_BREAKPOINT - 1]) {
			const layout = resolveDatabaseLayout(width);
			expect(layout.mode).toBe("narrow");
			expect(layout.autoTree).toBe(false);
			expect(layout.autoDetails).toBe(false);
		}
	});

	it("medium: 树自动显示，详情不自动显示（两栏）", () => {
		for (const width of [DATABASE_LAYOUT_TREE_BREAKPOINT, 640, 879, DATABASE_LAYOUT_DETAILS_BREAKPOINT - 1]) {
			const layout = resolveDatabaseLayout(width);
			expect(layout.mode).toBe("medium");
			expect(layout.autoTree).toBe(true);
			expect(layout.autoDetails).toBe(false);
		}
	});

	it("wide: 树与详情均自动显示（三栏）", () => {
		for (const width of [DATABASE_LAYOUT_DETAILS_BREAKPOINT, 1024, 1600]) {
			const layout = resolveDatabaseLayout(width);
			expect(layout.mode).toBe("wide");
			expect(layout.autoTree).toBe(true);
			expect(layout.autoDetails).toBe(true);
		}
	});
});
