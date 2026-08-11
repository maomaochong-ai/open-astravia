import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	attemptedFiles,
	finalizeRound,
	hashContent,
	KB_MAX_PROCESSING_ATTEMPTS,
	prepareRound,
	rawsDir,
	readFailures,
	readManifest,
	reconcileRoundFailures,
	scanWikiPages,
	wikiDir,
	writeKnowledgePage,
} from "../src/index.js";

describe("ingest round lifecycle (integration)", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "kb-ingest-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const writeRaw = (relPath: string, content: string): string => {
		const full = join(rawsDir(root), relPath);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content, "utf-8");
		return hashContent(content);
	};

	it("moved：同 hash 换 path → 工程侧更新 frontmatter，不变成新增/删除", async () => {
		const hash = writeRaw("g1/a.md", "hello");
		await writeKnowledgePage(
			root,
			{
				path: "topic/a.md",
				source: "g1",
				source_path: "g1/a.md",
				source_hash: hash,
				tags: ["t"],
				title: "A",
				summary: "s",
				body: "body",
			},
			"2026-06-22T00:00:00.000Z",
		);

		// 移动原始文件：删旧建新（内容不变）
		rmSync(join(rawsDir(root), "g1"), { recursive: true, force: true });
		writeRaw("g2/a.md", "hello");

		const { diff } = await prepareRound(root, "2026-06-22T01:00:00.000Z");
		expect(diff.moved).toHaveLength(1);
		expect(diff.added).toHaveLength(0);
		expect(diff.deleted).toHaveLength(0);

		const { pages } = await scanWikiPages(root);
		expect(pages).toHaveLength(1);
		expect(pages[0].frontmatter.source).toBe("g2");
		expect(pages[0].frontmatter.source_path).toBe("g2/a.md");
		expect(pages[0].frontmatter.orphaned_at).toBeNull();
	});

	it("删除 → 标孤儿；下一轮 finalize 才物理删除（n+1）", async () => {
		const hash = writeRaw("g/a.md", "hello");
		await writeKnowledgePage(
			root,
			{
				path: "topic/a.md",
				source: "g",
				source_path: "g/a.md",
				source_hash: hash,
				tags: ["t"],
				title: "A",
				summary: "s",
				body: "body",
			},
			"2026-06-22T00:00:00.000Z",
		);

		// 第 N 轮：删除原始文件
		rmSync(join(rawsDir(root), "g"), { recursive: true, force: true });
		const round1 = await prepareRound(root, "2026-06-22T01:00:00.000Z");
		expect(round1.diff.deleted).toHaveLength(1);
		expect(round1.toReap).toHaveLength(0); // 本轮刚标记，不回收

		let { pages } = await scanWikiPages(root);
		expect(pages).toHaveLength(1);
		expect(pages[0].frontmatter.orphaned_at).toBe("2026-06-22T01:00:00.000Z");

		// finalize round1：toReap 为空，页仍在
		await finalizeRound(root, round1.toReap);
		({ pages } = await scanWikiPages(root));
		expect(pages).toHaveLength(1);

		// 第 N+1 轮：上一轮孤儿进入 toReap
		const round2 = await prepareRound(root, "2026-06-22T02:00:00.000Z");
		expect(round2.toReap).toHaveLength(1);
		expect(round2.toReap[0].path).toBe("topic/a.md");

		// finalize round2：物理删除
		await finalizeRound(root, round2.toReap);
		({ pages } = await scanWikiPages(root));
		expect(pages).toHaveLength(0);

		const manifest = await readManifest(root);
		expect(manifest.pages).toHaveLength(0);
	});

	it("孤儿物理删除后清理 wiki 空目录（保留 wiki 根）", async () => {
		const hash = writeRaw("g/a.md", "hello");
		await writeKnowledgePage(
			root,
			{
				path: "主题/子/a.md",
				source: "g",
				source_path: "g/a.md",
				source_hash: hash,
				tags: ["t"],
				title: "A",
				summary: "s",
				body: "body",
			},
			"2026-06-22T00:00:00.000Z",
		);
		expect(existsSync(join(wikiDir(root), "主题", "子"))).toBe(true);

		// 删原始文件，走 n+1 回收
		rmSync(join(rawsDir(root), "g"), { recursive: true, force: true });
		const r1 = await prepareRound(root, "2026-06-22T01:00:00.000Z");
		await finalizeRound(root, r1.toReap); // 标记轮，未删
		const r2 = await prepareRound(root, "2026-06-22T02:00:00.000Z");
		await finalizeRound(root, r2.toReap); // 物理删除页 + 清空目录

		expect((await scanWikiPages(root)).pages).toHaveLength(0);
		expect(existsSync(join(wikiDir(root), "主题", "子"))).toBe(false);
		expect(existsSync(join(wikiDir(root), "主题"))).toBe(false);
		expect(existsSync(wikiDir(root))).toBe(true); // wiki 根始终保留
	});

	it("added/changed 在 diff 中暴露给 agent", async () => {
		const h1 = writeRaw("g/new.md", "fresh");
		const { diff } = await prepareRound(root, "2026-06-22T00:00:00.000Z");
		expect(diff.added).toHaveLength(1);
		expect(diff.added[0].raw.source_hash).toBe(h1);
	});

	// 回归：永远写不出 wiki 页的文件（如 OCR 失败的 PDF），过去每轮都重入 added → 无限加工。
	// 现在连续失败达阈值后被隔离，prepareRound 不再把它放进 added。
	it("止损：永久失败的文件连续 N 轮后被隔离，不再无限重入 added", async () => {
		writeRaw("g/broken.pdf", "cannot be processed");

		// 模拟「加工但永远写不出 wiki 页」的多轮：每轮 prepareRound 仍给出 added，
		// 但 reconcile 时 wiki 里查不到该 hash → 失败计数累加。
		for (let i = 1; i <= KB_MAX_PROCESSING_ATTEMPTS; i++) {
			const now = `2026-06-22T0${i}:00:00.000Z`;
			const { diff } = await prepareRound(root, now);
			// 达到阈值前每轮都还会尝试
			expect(diff.added).toHaveLength(1);
			// agent 没写出任何 wiki 页 → 对账记为失败
			await reconcileRoundFailures(root, attemptedFiles(diff), now);
		}

		const failures = await readFailures(root);
		const entry = Object.values(failures.entries)[0];
		expect(entry.attempts).toBe(KB_MAX_PROCESSING_ATTEMPTS);
		expect(entry.quarantined).toBe(true);

		// 下一轮：已隔离 → 不再出现在 added（无限加工被止损）
		const after = await prepareRound(root, "2026-06-22T09:00:00.000Z");
		expect(after.diff.added).toHaveLength(0);
	});

	it("止损：隔离文件内容变化（hash 变）→ 视为新文件，自动重试", async () => {
		writeRaw("g/broken.pdf", "v1 broken");
		for (let i = 1; i <= KB_MAX_PROCESSING_ATTEMPTS; i++) {
			const now = `2026-06-22T0${i}:00:00.000Z`;
			const { diff } = await prepareRound(root, now);
			await reconcileRoundFailures(root, attemptedFiles(diff), now);
		}
		expect((await prepareRound(root, "2026-06-22T08:00:00.000Z")).diff.added).toHaveLength(0);

		// 用户修好了文件（内容变 → hash 变）
		writeRaw("g/broken.pdf", "v2 fixed content");
		const after = await prepareRound(root, "2026-06-22T09:00:00.000Z");
		expect(after.diff.added).toHaveLength(1);
		// 旧 hash 的失败记录被剪枝
		await reconcileRoundFailures(root, attemptedFiles(after.diff), "2026-06-22T09:00:00.000Z");
		const failures = await readFailures(root);
		expect(Object.keys(failures.entries)).toHaveLength(1); // 仅新 hash 的一条（本轮也没写出页）
	});
});
