import { describe, expect, it } from "vitest";
import {
	parseWikiPage,
	resolveUpsert,
	serializeWikiPage,
	type UpsertInput,
	type UpsertLookup,
	validateWikiFrontmatter,
	type WikiFrontmatter,
	WikiFrontmatterError,
} from "../src/index.js";

const fm = (over: Partial<WikiFrontmatter> = {}): WikiFrontmatter => ({
	id: "page-1",
	source: "手册",
	source_path: "手册/api.md",
	source_hash: "h1",
	tags: ["api", "manual"],
	title: "API",
	summary: "接口文档",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	orphaned_at: null,
	...over,
});

describe("validateWikiFrontmatter", () => {
	it("合法 frontmatter 通过", () => {
		expect(validateWikiFrontmatter(fm())).toMatchObject({ id: "page-1", tags: ["api", "manual"] });
	});

	it("封闭 schema 拒绝未知字段", () => {
		expect(() => validateWikiFrontmatter({ ...fm(), extra: 1 })).toThrow(WikiFrontmatterError);
	});

	it("缺必填字段报错", () => {
		const { id, ...rest } = fm();
		void id;
		expect(() => validateWikiFrontmatter(rest)).toThrow(WikiFrontmatterError);
	});

	it("tags 非数组报错", () => {
		expect(() => validateWikiFrontmatter({ ...fm(), tags: "api" })).toThrow(WikiFrontmatterError);
	});

	it("orphaned_at 允许 null 或字符串", () => {
		expect(validateWikiFrontmatter(fm({ orphaned_at: null })).orphaned_at).toBeNull();
		expect(validateWikiFrontmatter(fm({ orphaned_at: "2026-06-22T00:00:00.000Z" })).orphaned_at).toBe(
			"2026-06-22T00:00:00.000Z",
		);
	});
});

describe("serialize / parse round-trip", () => {
	it("序列化后能解析回等价 frontmatter", () => {
		const original = fm({ tags: ["a", "b"] });
		const doc = serializeWikiPage(original, "# 正文\n\n内容 [[other-id]]");
		expect(doc.startsWith("---\n")).toBe(true);
		const parsed = parseWikiPage(doc);
		expect(parsed.frontmatter).toEqual(original);
		expect(parsed.body).toContain("[[other-id]]");
	});

	it("解析缺 frontmatter 的文档报错", () => {
		expect(() => parseWikiPage("# 只有正文")).toThrow(WikiFrontmatterError);
	});
});

describe("resolveUpsert", () => {
	const now = "2026-06-22T12:00:00.000Z";
	const genId = () => "new-generated-id";

	const lookupWith = (pages: WikiFrontmatter[]): UpsertLookup => ({
		byId: (id) => pages.find((p) => p.id === id),
		bySource: (h, sp) => pages.find((p) => p.source_hash === h && p.source_path === sp),
	});

	const input = (over: Partial<UpsertInput> = {}): UpsertInput => ({
		source: "手册",
		source_path: "手册/api.md",
		source_hash: "h-new",
		tags: ["api"],
		title: "API",
		summary: "接口",
		...over,
	});

	it("传 id 命中 → 就地更新，保留 id+created_at，刷新 updated_at，清孤儿", () => {
		const existing = fm({ id: "page-1", source_hash: "h-old", orphaned_at: "2026-05-01T00:00:00.000Z" });
		const decision = resolveUpsert(input({ id: "page-1" }), lookupWith([existing]), now, genId);
		expect(decision.action).toBe("update");
		if (decision.action !== "update") throw new Error("unreachable");
		expect(decision.id).toBe("page-1");
		expect(decision.frontmatter.created_at).toBe(existing.created_at);
		expect(decision.frontmatter.updated_at).toBe(now);
		expect(decision.frontmatter.source_hash).toBe("h-new");
		expect(decision.frontmatter.orphaned_at).toBeNull();
	});

	it("无 id 但 source_hash + source_path 同时命中 → 更新该页", () => {
		const existing = fm({ id: "page-1", source_hash: "h-new", source_path: "手册/api.md" });
		const decision = resolveUpsert(
			input({ source_hash: "h-new", source_path: "手册/api.md" }),
			lookupWith([existing]),
			now,
			genId,
		);
		expect(decision.action).toBe("update");
		if (decision.action !== "update") throw new Error("unreachable");
		expect(decision.id).toBe("page-1");
	});

	it("无 id、同 source_hash 但 source_path 不同（同内容副本）→ 新建独立页，不并入既有页", () => {
		// 复现 bug：用户把同一份内容拷贝到两个路径，差异化身份须各自建页；
		// 否则后写并入前页、删旧路径 → 该副本下轮被判 added → 无限重加工 / 文件变灰。
		const existing = fm({ id: "page-1", source_hash: "dup", source_path: "手册/a/批复.pdf" });
		const decision = resolveUpsert(
			input({ source_hash: "dup", source_path: "手册/b/批复.pdf" }),
			lookupWith([existing]),
			now,
			genId,
		);
		expect(decision.action).toBe("create");
		expect(decision.frontmatter.id).toBe("new-generated-id");
		expect(decision.frontmatter.source_path).toBe("手册/b/批复.pdf");
	});

	it("无 id 且 source_hash 不存在 → 新建并分配 id", () => {
		const decision = resolveUpsert(input(), lookupWith([]), now, genId);
		expect(decision.action).toBe("create");
		expect(decision.frontmatter.id).toBe("new-generated-id");
		expect(decision.frontmatter.created_at).toBe(now);
		expect(decision.frontmatter.updated_at).toBe(now);
	});

	it("传了不存在的 id 且 hash 也不存在 → 新建", () => {
		const decision = resolveUpsert(input({ id: "ghost" }), lookupWith([]), now, genId);
		expect(decision.action).toBe("create");
	});

	it("接受只读 tags 且不修改调用方数组", () => {
		const tags = Object.freeze([" API ", "Manual"]);
		const decision = resolveUpsert(input({ tags }), lookupWith([]), now, genId);
		expect(decision.frontmatter.tags).toEqual([" API ", "Manual"]);
		expect(tags).toEqual([" API ", "Manual"]);
	});
});
