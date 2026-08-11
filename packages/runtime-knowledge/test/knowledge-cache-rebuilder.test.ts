import { describe, expect, it } from "vitest";
import { rebuildManifest, rebuildTagsIndex, type WikiFrontmatter, type WikiPageRef } from "../src/index.js";

const fm = (over: Partial<WikiFrontmatter>): WikiFrontmatter => ({
	id: "id",
	source: "g",
	source_path: "g/a.md",
	source_hash: "h",
	tags: [],
	title: "t",
	summary: "s",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	orphaned_at: null,
	...over,
});

const page = (frontmatter: WikiFrontmatter, path: string): WikiPageRef => ({ frontmatter, path });

describe("rebuildManifest", () => {
	it("空库 → 空 manifest", () => {
		expect(rebuildManifest([])).toEqual({ version: 1, pages: [] });
	});

	it("每页映射为一条，含孤儿，按 id 排序", () => {
		const m = rebuildManifest([
			page(fm({ id: "b", source_path: "g/b.md" }), "b.md"),
			page(fm({ id: "a", source_path: "g/a.md", orphaned_at: "2026-06-01T00:00:00.000Z" }), "a.md"),
		]);
		expect(m.pages.map((p) => p.id)).toEqual(["a", "b"]);
		expect(m.pages[0]).toEqual({
			id: "a",
			path: "a.md",
			source_path: "g/a.md",
			source_hash: "h",
			orphaned_at: "2026-06-01T00:00:00.000Z",
		});
	});
});

describe("rebuildTagsIndex", () => {
	it("空库 → 空索引", () => {
		expect(rebuildTagsIndex([])).toEqual({ version: 1, tags: {} });
	});

	it("tag → 排序去重 id；孤儿页被排除", () => {
		const idx = rebuildTagsIndex([
			page(fm({ id: "2", tags: ["x", "y"] }), "2.md"),
			page(fm({ id: "1", tags: ["x"] }), "1.md"),
			page(fm({ id: "orphan", tags: ["x"], orphaned_at: "2026-06-01T00:00:00.000Z" }), "o.md"),
		]);
		expect(idx.tags).toEqual({ x: ["1", "2"], y: ["2"] });
	});

	it("幂等：对同一组页重建结果一致", () => {
		const pages = [page(fm({ id: "1", tags: ["a"] }), "1.md"), page(fm({ id: "2", tags: ["a", "b"] }), "2.md")];
		expect(rebuildTagsIndex(pages)).toEqual(rebuildTagsIndex(pages));
	});
});
