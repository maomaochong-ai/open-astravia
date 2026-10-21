import { DEFAULT_FILE_EXPLORER_PREFERENCES, type FileExplorerPreferences } from "@shared/lib/file-explorer-preferences";
import type { FsEntry } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { createFileTreeVisibleCache } from "./file-tree-visible-cache";

const ROOT = "/workspace";

function entry(path: string, isDirectory = false): FsEntry {
	return { name: path.split("/").pop() ?? path, path, isDirectory, size: 0, modifiedAt: 0 };
}

function preferences(overrides: Partial<FileExplorerPreferences> = {}): FileExplorerPreferences {
	return { ...DEFAULT_FILE_EXPLORER_PREFERENCES, ...overrides };
}

describe("createFileTreeVisibleCache", () => {
	it("filters excluded files and keeps the root directory visible", () => {
		const cache = createFileTreeVisibleCache();
		const visible = cache.compute(
			ROOT,
			new Map([
				[ROOT, [entry(`${ROOT}/src`, true), entry(`${ROOT}/.DS_Store`)]],
				[`${ROOT}/src`, [entry(`${ROOT}/src/index.ts`)]],
			]),
			preferences(),
		);

		expect(visible.get(ROOT)?.map((item) => item.name)).toEqual(["src"]);
		expect(visible.get(`${ROOT}/src`)?.map((item) => item.name)).toEqual(["index.ts"]);
	});

	it("reuses the filtered result of directories that did not change", () => {
		const cache = createFileTreeVisibleCache();
		const rootEntries = [entry(`${ROOT}/src`, true)];
		const srcEntries = [entry(`${ROOT}/src/index.ts`)];
		const prefs = preferences();

		const first = cache.compute(ROOT, new Map([[ROOT, rootEntries]]), prefs);
		const second = cache.compute(
			ROOT,
			new Map([
				[ROOT, rootEntries],
				[`${ROOT}/src`, srcEntries],
			]),
			prefs,
		);

		expect(second.get(`${ROOT}/src`)?.map((item) => item.name)).toEqual(["index.ts"]);
		// 同一引用说明根目录没有因为新增一层而被重新过滤。
		expect(second.get(ROOT)).toBe(first.get(ROOT));
	});

	it("recomputes a directory whose entries were replaced", () => {
		const cache = createFileTreeVisibleCache();
		const prefs = preferences();
		const before = cache.compute(ROOT, new Map([[ROOT, [entry(`${ROOT}/a.ts`)]]]), prefs);
		const after = cache.compute(ROOT, new Map([[ROOT, [entry(`${ROOT}/a.ts`), entry(`${ROOT}/b.ts`)]]]), prefs);

		expect(before.get(ROOT)?.map((item) => item.name)).toEqual(["a.ts"]);
		expect(after.get(ROOT)?.map((item) => item.name)).toEqual(["a.ts", "b.ts"]);
		expect(after.get(ROOT)).not.toBe(before.get(ROOT));
	});

	it("recomputes everything when preferences change", () => {
		const cache = createFileTreeVisibleCache();
		const entries = [entry(`${ROOT}/.env`), entry(`${ROOT}/src`, true)];
		const withHidden = cache.compute(ROOT, new Map([[ROOT, entries]]), preferences());
		const withoutHidden = cache.compute(ROOT, new Map([[ROOT, entries]]), preferences({ showHidden: false }));

		expect(withHidden.get(ROOT)?.map((item) => item.name)).toEqual([".env", "src"]);
		expect(withoutHidden.get(ROOT)?.map((item) => item.name)).toEqual(["src"]);
	});

	it("drops cached directories that left the cache", () => {
		const cache = createFileTreeVisibleCache();
		const prefs = preferences();
		const srcEntries = [entry(`${ROOT}/src/index.ts`)];
		cache.compute(ROOT, new Map([[`${ROOT}/src`, srcEntries]]), prefs);
		const collapsed = cache.compute(ROOT, new Map(), prefs);

		expect(collapsed.size).toBe(0);
		const reexpanded = cache.compute(ROOT, new Map([[`${ROOT}/src`, srcEntries]]), prefs);
		expect(reexpanded.get(`${ROOT}/src`)?.map((item) => item.name)).toEqual(["index.ts"]);
	});
});
