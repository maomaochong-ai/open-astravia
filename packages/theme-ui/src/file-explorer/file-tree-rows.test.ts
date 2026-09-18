import { describe, expect, it } from "vitest";
import {
	buildFileTreeRows,
	createFileTreeRowHeightStore,
	FILE_TREE_ROW_HEIGHT,
	hitTestFileTreeMarquee,
} from "./file-tree-rows";
import type { FileExplorerEntry } from "./types";

function file(path: string): FileExplorerEntry {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, isDirectory: false, size: 1, modifiedAt: 0 };
}

function flatRows(count: number) {
	return buildFileTreeRows({
		rootDir: "/proj",
		cache: new Map([["/proj", Array.from({ length: count }, (_, index) => file(`/proj/f-${index}.ts`))]]),
		expandedDirs: new Set(),
		creatingEntry: null,
	});
}

describe("hitTestFileTreeMarquee with measured row heights", () => {
	it("第 100 行附近的框选按实测 24px 行高命中，而不是按常量累加", () => {
		const rows = flatRows(200);
		const measured = createFileTreeRowHeightStore(22);
		// The virtual list only ever measures mounted rows; the marquee target is far outside them.
		for (let index = 0; index < 20; index++) measured.record(rows[index]?.key ?? "", 24);

		const hits = hitTestFileTreeMarquee(rows, { left: 0, top: 24 * 100 + 2, width: 80, height: 20 }, measured);

		expect(hits).toEqual(["/proj/f-100.ts"]);
		// Sanity: a stale 22px constant would have pointed ~9 rows further down.
		expect(hitTestFileTreeMarquee(rows, { left: 0, top: 24 * 100 + 2, width: 80, height: 20 }, 22)[0]).toBe(
			"/proj/f-109.ts",
		);
	});

	it("未测量的行沿用已测量行的平均高度，框选跨过测量边界时行号连续", () => {
		const rows = flatRows(50);
		const measured = createFileTreeRowHeightStore(FILE_TREE_ROW_HEIGHT);
		expect(measured.estimatedRowHeight()).toBe(FILE_TREE_ROW_HEIGHT);
		for (let index = 0; index < 10; index++) measured.record(rows[index]?.key ?? "", 30);
		expect(measured.estimatedRowHeight()).toBe(30);

		// Rows 8..11 straddle the measured/unmeasured boundary; every row is 30px so all four are hit.
		const hits = hitTestFileTreeMarquee(rows, { left: 0, top: 30 * 8, width: 40, height: 30 * 4 }, measured);
		expect(hits).toEqual(["/proj/f-8.ts", "/proj/f-9.ts", "/proj/f-10.ts", "/proj/f-11.ts"]);
	});

	it("行被折叠掉之后其测量值不再影响平均高度", () => {
		const store = createFileTreeRowHeightStore(24);
		store.record("a", 20);
		store.record("b", 40);
		expect(store.estimatedRowHeight()).toBe(30);
		store.prune(new Set(["a"]));
		expect(store.estimatedRowHeight()).toBe(20);
		store.record("a", 24);
		expect(store.estimatedRowHeight()).toBe(24);
		store.record("zero", 0);
		expect(store.estimatedRowHeight()).toBe(24);
	});

	it("固定行高的旧调用方式保持原有命中结果", () => {
		const rows = flatRows(40);
		expect(hitTestFileTreeMarquee(rows, { left: 0, top: 22 * 30, width: 120, height: 22 * 3 }, 22)).toEqual([
			"/proj/f-30.ts",
			"/proj/f-31.ts",
			"/proj/f-32.ts",
		]);
		expect(hitTestFileTreeMarquee(rows, { left: 0, top: 0, width: 0, height: 22 }, 22)).toEqual([]);
		expect(hitTestFileTreeMarquee(rows, { left: 0, top: 0, width: 10, height: 22 }, 0)).toEqual([]);
	});
});
