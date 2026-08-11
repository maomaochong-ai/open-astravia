import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createKnowledgePageWriter,
	listAvailableTags,
	queryByTags,
	readManifest,
	readTagsIndex,
	rebuildAllCaches,
	scanWikiPages,
	writeKnowledgePage,
} from "../src/index.js";

describe("writeKnowledgePage (integration)", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "kb-writer-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const baseReq = {
		path: "产品/api.md",
		source: "手册",
		source_path: "手册/api.md",
		source_hash: "h1",
		tags: ["api", "manual"],
		title: "API",
		summary: "接口文档",
		body: "# API\n\n内容",
	};

	it("新建页：分配 id，写盘；缓存由 rebuildAllCaches 统一重建", async () => {
		const res = await writeKnowledgePage(root, baseReq, "2026-06-22T00:00:00.000Z");
		expect(res.action).toBe("create");
		expect(res.id).toBeTruthy();

		const { pages } = await scanWikiPages(root);
		expect(pages).toHaveLength(1);
		expect(pages[0].frontmatter.title).toBe("API");

		// 写页本身不再顺带重建缓存（避免一轮内每写一页就全量重建）。
		expect((await readManifest(root)).pages).toHaveLength(0);

		// 重建后缓存据真相源（frontmatter）反映该页。
		await rebuildAllCaches(root);
		const manifest = await readManifest(root);
		expect(manifest.pages).toHaveLength(1);
		expect(manifest.pages[0].path).toBe("产品/api.md");

		const tags = await readTagsIndex(root);
		expect(tags.tags.api).toEqual([res.id]);
		expect(tags.tags.manual).toEqual([res.id]);
	});

	it("按 id 就地更新：保留 id+created_at，刷新内容", async () => {
		const created = await writeKnowledgePage(root, baseReq, "2026-06-22T00:00:00.000Z");
		const updated = await writeKnowledgePage(
			root,
			{ ...baseReq, id: created.id, source_hash: "h2", title: "API v2", body: "# API v2" },
			"2026-06-23T00:00:00.000Z",
		);
		expect(updated.action).toBe("update");
		expect(updated.id).toBe(created.id);

		const { pages } = await scanWikiPages(root);
		expect(pages).toHaveLength(1);
		expect(pages[0].frontmatter.title).toBe("API v2");
		expect(pages[0].frontmatter.created_at).toBe("2026-06-22T00:00:00.000Z");
		expect(pages[0].frontmatter.updated_at).toBe("2026-06-23T00:00:00.000Z");
		expect(pages[0].frontmatter.source_hash).toBe("h2");
	});

	it("更新时换 path → 移动（旧文件删除，单页保持）", async () => {
		const created = await writeKnowledgePage(root, baseReq, "2026-06-22T00:00:00.000Z");
		const moved = await writeKnowledgePage(
			root,
			{ ...baseReq, id: created.id, path: "产品/接口/api.md" },
			"2026-06-23T00:00:00.000Z",
		);
		expect(moved.movedFrom).toBe("产品/api.md");

		const { pages } = await scanWikiPages(root);
		expect(pages).toHaveLength(1);
		expect(pages[0].path).toBe("产品/接口/api.md");
	});

	it("无 id 但同 source_hash → 命中更新而非新建", async () => {
		const created = await writeKnowledgePage(root, baseReq, "2026-06-22T00:00:00.000Z");
		const again = await writeKnowledgePage(root, { ...baseReq, title: "改了标题" }, "2026-06-23T00:00:00.000Z");
		expect(again.action).toBe("update");
		expect(again.id).toBe(created.id);
		const { pages } = await scanWikiPages(root);
		expect(pages).toHaveLength(1);
	});

	it("同名不同目录两份原始文件抢同一 wiki path → 自动消歧，不互相覆盖", async () => {
		// 复现 bug：两个 source_hash 不同的原始文件（同名不同目录），LLM 给了相同的语义 path。
		// 修复前：后写覆盖前写，磁盘只剩一页 → manifest 丢一条 → 下轮重新判定 added → 无限重加工。
		const session = await createKnowledgePageWriter(root);
		const a = await session.write(
			{ ...baseReq, source_path: "手册/a/readme.md", source_hash: "ha", title: "A" },
			"2026-06-22T00:00:00.000Z",
		);
		const b = await session.write(
			{ ...baseReq, source_path: "手册/b/readme.md", source_hash: "hb", title: "B" },
			"2026-06-22T00:00:00.000Z",
		);

		// 两个不同的页 id，落到两个不同的物理路径。
		expect(a.id).not.toBe(b.id);
		expect(a.path).toBe("产品/api.md");
		expect(b.path).not.toBe(a.path);

		const { pages } = await scanWikiPages(root);
		expect(pages).toHaveLength(2);

		// 重建后两条 source_hash 都在 manifest 里 → 下一轮 diff 不会把任何一个再判为 added。
		await rebuildAllCaches(root);
		const manifest = await readManifest(root);
		expect(manifest.pages).toHaveLength(2);
		expect(manifest.pages.map((p) => p.source_hash).sort()).toEqual(["ha", "hb"]);

		// 同一页跨轮重写同一语义 path → 稳定落回自己那份，不再新增、不抢占。
		const session2 = await createKnowledgePageWriter(root);
		const bAgain = await session2.write(
			{ ...baseReq, id: b.id, source_path: "手册/b/readme.md", source_hash: "hb2", title: "B2" },
			"2026-06-23T00:00:00.000Z",
		);
		expect(bAgain.action).toBe("update");
		expect(bAgain.id).toBe(b.id);
		expect(bAgain.path).toBe(b.path);
		expect((await scanWikiPages(root)).pages).toHaveLength(2);
	});

	it("同内容（同 source_hash）不同 source_path 两份原始文件 → 各自建独立页，不并成一页", async () => {
		// 复现 bug：用户把同一份内容拷贝到两个不同路径（同 sha256）。
		// 修复前：第二份按 source_hash 命中第一页 → 更新并删掉第一页旧路径，磁盘只剩一页 →
		// 被删的那份下轮被判 added → 无限重加工，且 UI 上常驻灰色。
		const session = await createKnowledgePageWriter(root);
		const a = await session.write(
			{ ...baseReq, source_path: "手册/a/批复.pdf", source_hash: "dup", title: "A" },
			"2026-06-22T00:00:00.000Z",
		);
		const b = await session.write(
			{ ...baseReq, source_path: "手册/b/批复.pdf", source_hash: "dup", title: "B" },
			"2026-06-22T00:00:00.000Z",
		);

		expect(b.action).toBe("create");
		expect(a.id).not.toBe(b.id);
		expect(b.path).not.toBe(a.path);

		const { pages } = await scanWikiPages(root);
		expect(pages).toHaveLength(2);

		await rebuildAllCaches(root);
		const manifest = await readManifest(root);
		expect(manifest.pages).toHaveLength(2);
		expect(manifest.pages.map((p) => p.source_path).sort()).toEqual(["手册/a/批复.pdf", "手册/b/批复.pdf"]);
	});

	it("queryByTags 读到写入的页", async () => {
		await writeKnowledgePage(root, baseReq, "2026-06-22T00:00:00.000Z");
		await writeKnowledgePage(
			root,
			{
				...baseReq,
				path: "产品/billing.md",
				source_path: "手册/billing.md",
				source_hash: "hb",
				tags: ["billing"],
				title: "计费",
			},
			"2026-06-22T00:00:00.000Z",
		);
		const apiPages = await queryByTags(root, { all: ["api"] });
		expect(apiPages.map((p) => p.title)).toEqual(["API"]);
		const notBilling = await queryByTags(root, { none: ["billing"] });
		expect(notBilling.map((p) => p.title)).toEqual(["API"]);

		// listAvailableTags：聚合标签与页数，按页数降序
		const tags = await listAvailableTags(root);
		expect(tags).toEqual([
			{ tag: "api", count: 1 },
			{ tag: "billing", count: 1 },
			{ tag: "manual", count: 1 },
		]);

		// 内容里的 frontmatter body 含 [[id]] 不影响解析
		const doc = await readFile(join(root, "wiki", "产品", "api.md"), "utf-8");
		expect(doc).toContain("source_hash: h1");
	});
});
