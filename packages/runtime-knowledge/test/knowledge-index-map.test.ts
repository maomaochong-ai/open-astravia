import { describe, expect, it } from "vitest";
import { buildIndexMap, type WikiFrontmatter, type WikiPageRef } from "../src/index.js";

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

describe("buildIndexMap", () => {
	it("空库 → 占位", () => {
		expect(buildIndexMap([])).toContain("_（暂无页面）_");
	});

	it("镜像 wiki 树：文件夹层级 + title/summary/[[id]]", () => {
		const md = buildIndexMap([
			page(fm({ id: "1", title: "计费", summary: "计费规则" }), "产品/计费.md"),
			page(fm({ id: "2", title: "配额", summary: "配额上限" }), "产品/高级/配额.md"),
			page(fm({ id: "3", title: "首页", summary: "" }), "首页.md"),
		]);
		expect(md).toContain("- **产品/**");
		expect(md).toContain("  - **计费** — 计费规则 `[[1]]`");
		expect(md).toContain("  - **高级/**");
		expect(md).toContain("    - **配额** — 配额上限 `[[2]]`");
		// 根级页、空 summary → 不带破折号
		expect(md).toContain("- **首页** `[[3]]`");
	});

	it("排除孤儿页", () => {
		const md = buildIndexMap([
			page(fm({ id: "live", title: "在世" }), "a.md"),
			page(fm({ id: "dead", title: "孤儿", orphaned_at: "2026-06-01T00:00:00.000Z" }), "b.md"),
		]);
		expect(md).toContain("在世");
		expect(md).not.toContain("孤儿");
	});

	it("幂等：同一组页生成结果一致", () => {
		const pages = [page(fm({ id: "1", title: "B" }), "x/b.md"), page(fm({ id: "2", title: "A" }), "x/a.md")];
		expect(buildIndexMap(pages)).toBe(buildIndexMap(pages));
	});
});
