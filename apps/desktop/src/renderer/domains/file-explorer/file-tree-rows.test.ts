import {
	buildFileTreeRows,
	FILE_TREE_ROW_HEIGHT,
	type FileExplorerEntry,
	type FileTreeRow,
	hitTestFileTreeMarquee,
} from "@vetta-org/theme-ui/file-explorer";
import { describe, expect, it } from "vitest";

function file(path: string, name = path.slice(path.lastIndexOf("/") + 1)): FileExplorerEntry {
	return { name, path, isDirectory: false, size: 1, modifiedAt: 0 };
}

function dir(path: string, name = path.slice(path.lastIndexOf("/") + 1)): FileExplorerEntry {
	return { name, path, isDirectory: true, size: 0, modifiedAt: 0 };
}

function entryPaths(rows: readonly FileTreeRow[]): string[] {
	return rows.filter((row) => row.type === "entry").map((row) => row.entry.path);
}

describe("buildFileTreeRows", () => {
	it("用户展开目录后，子文件紧跟在父目录后面出现", () => {
		const cache = new Map<string, FileExplorerEntry[]>([
			["/proj", [dir("/proj/src"), file("/proj/README.md")]],
			["/proj/src", [file("/proj/src/a.ts"), file("/proj/src/b.ts")]],
		]);

		const collapsed = buildFileTreeRows({
			rootDir: "/proj",
			cache,
			expandedDirs: new Set(),
			creatingEntry: null,
		});
		expect(entryPaths(collapsed)).toEqual(["/proj/src", "/proj/README.md"]);

		const expanded = buildFileTreeRows({
			rootDir: "/proj",
			cache,
			expandedDirs: new Set(["/proj/src"]),
			creatingEntry: null,
		});
		expect(entryPaths(expanded)).toEqual(["/proj/src", "/proj/src/a.ts", "/proj/src/b.ts", "/proj/README.md"]);
		expect(expanded.map((row) => row.depth)).toEqual([0, 1, 1, 0]);
	});

	it("在根目录新建时，创建行出现在第一项文件之前", () => {
		const rows = buildFileTreeRows({
			rootDir: "/proj",
			cache: new Map([["/proj", [file("/proj/a.ts")]]]),
			expandedDirs: new Set(),
			creatingEntry: { parentPath: "/proj", kind: "file", error: null, busy: false },
		});
		expect(rows.map((row) => row.type)).toEqual(["create", "entry"]);
		expect(rows[0]).toMatchObject({ type: "create", depth: 0, parentPath: "/proj", kind: "file" });
	});

	it("在已展开目录里新建时，创建行插在该目录行之后、子文件之前", () => {
		const rows = buildFileTreeRows({
			rootDir: "/proj",
			cache: new Map([
				["/proj", [dir("/proj/src")]],
				["/proj/src", [file("/proj/src/a.ts")]],
			]),
			expandedDirs: new Set(["/proj/src"]),
			creatingEntry: { parentPath: "/proj/src", kind: "directory", error: null, busy: false },
		});
		expect(rows.map((row) => ({ type: row.type, key: row.key }))).toEqual([
			{ type: "entry", key: "/proj/src" },
			{ type: "create", key: "create:/proj/src:directory" },
			{ type: "entry", key: "/proj/src/a.ts" },
		]);
		expect(rows[1]).toMatchObject({ type: "create", depth: 1 });
	});

	it("2000 个可见文件可以在一帧预算内展平为稳定行表", () => {
		const files = Array.from({ length: 2000 }, (_, index) => file(`/proj/f-${index}.ts`));
		const started = performance.now();
		const rows = buildFileTreeRows({
			rootDir: "/proj",
			cache: new Map([["/proj", files]]),
			expandedDirs: new Set(),
			creatingEntry: null,
		});
		const elapsed = performance.now() - started;
		expect(rows).toHaveLength(2000);
		expect(elapsed).toBeLessThan(50);
	});
});

describe("hitTestFileTreeMarquee", () => {
	const rows = buildFileTreeRows({
		rootDir: "/proj",
		cache: new Map([["/proj", Array.from({ length: 40 }, (_, index) => file(`/proj/f-${index}.ts`))]]),
		expandedDirs: new Set(),
		creatingEntry: null,
	});

	it("框选只命中几何相交的行，滚出视口的文件仍然可选", () => {
		const top = FILE_TREE_ROW_HEIGHT * 30;
		const hits = hitTestFileTreeMarquee(rows, {
			left: 0,
			top,
			width: 120,
			height: FILE_TREE_ROW_HEIGHT * 3,
		});
		expect(hits).toEqual(["/proj/f-30.ts", "/proj/f-31.ts", "/proj/f-32.ts"]);
	});

	it("创建行没有路径，框选穿过它时不会选中占位行", () => {
		const withCreate = buildFileTreeRows({
			rootDir: "/proj",
			cache: new Map([["/proj", [file("/proj/a.ts"), file("/proj/b.ts")]]]),
			expandedDirs: new Set(),
			creatingEntry: { parentPath: "/proj", kind: "file", error: null, busy: false },
		});
		expect(hitTestFileTreeMarquee(withCreate, { left: 0, top: 0, width: 80, height: FILE_TREE_ROW_HEIGHT })).toEqual(
			[],
		);
		expect(
			hitTestFileTreeMarquee(withCreate, {
				left: 0,
				top: 0,
				width: 80,
				height: FILE_TREE_ROW_HEIGHT * 2,
			}),
		).toEqual(["/proj/a.ts"]);
	});
});
