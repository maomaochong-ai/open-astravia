import { describe, expect, it } from "vitest";
import { diffRaws, type Manifest, type ManifestEntry, planOrphans, type RawFile } from "../src/index.js";

const entry = (over: Partial<ManifestEntry>): ManifestEntry => ({
	id: "id-1",
	path: "a.md",
	source_path: "g/a.md",
	source_hash: "h1",
	orphaned_at: null,
	...over,
});

const raw = (over: Partial<RawFile>): RawFile => ({
	source: "g",
	source_path: "g/a.md",
	source_hash: "h1",
	size: 0,
	...over,
});

describe("diffRaws", () => {
	it("空对空 → 全空 diff", () => {
		const d = diffRaws([], []);
		expect(d).toEqual({ added: [], moved: [], changed: [], deleted: [] });
	});

	it("纯新增", () => {
		const d = diffRaws([], [raw({ source_path: "g/new.md", source_hash: "hx" })]);
		expect(d.added).toHaveLength(1);
		expect(d.added[0].raw.source_path).toBe("g/new.md");
		expect(d.moved).toHaveLength(0);
		expect(d.changed).toHaveLength(0);
		expect(d.deleted).toHaveLength(0);
	});

	it("exact 未变 → 全空", () => {
		const prior = [entry({ id: "p1", source_path: "g/a.md", source_hash: "h1" })];
		const d = diffRaws(prior, [raw({ source_path: "g/a.md", source_hash: "h1" })]);
		expect(d.added).toHaveLength(0);
		expect(d.moved).toHaveLength(0);
		expect(d.changed).toHaveLength(0);
		expect(d.deleted).toHaveLength(0);
	});

	it("纯删除 → deleted（标孤儿）", () => {
		const prior = [entry({ id: "p1", source_path: "g/a.md", source_hash: "h1" })];
		const d = diffRaws(prior, []);
		expect(d.deleted).toHaveLength(1);
		expect(d.deleted[0].id).toBe("p1");
	});

	it("同 hash 换 path → moved，解析正确 id，不重加工", () => {
		const prior = [entry({ id: "p1", source_path: "g/a.md", source_hash: "h1" })];
		const d = diffRaws(prior, [raw({ source: "other", source_path: "other/a.md", source_hash: "h1" })]);
		expect(d.moved).toHaveLength(1);
		expect(d.moved[0]).toMatchObject({
			id: "p1",
			from: "g/a.md",
			to: "other/a.md",
			source: "other",
		});
		expect(d.changed).toHaveLength(0);
		expect(d.added).toHaveLength(0);
		expect(d.deleted).toHaveLength(0);
	});

	it("同 path 换 hash → changed，解析旧 id", () => {
		const prior = [entry({ id: "p1", source_path: "g/a.md", source_hash: "h1" })];
		const d = diffRaws(prior, [raw({ source_path: "g/a.md", source_hash: "h2" })]);
		expect(d.changed).toHaveLength(1);
		expect(d.changed[0]).toMatchObject({ id: "p1", oldHash: "h1", newHash: "h2" });
		expect(d.moved).toHaveLength(0);
		expect(d.added).toHaveLength(0);
		expect(d.deleted).toHaveLength(0);
	});

	it("既改名又改内容 → added + deleted（无法识别为 move/changed）", () => {
		const prior = [entry({ id: "p1", source_path: "g/a.md", source_hash: "h1" })];
		const d = diffRaws(prior, [raw({ source_path: "g/renamed.md", source_hash: "h2" })]);
		expect(d.added).toHaveLength(1);
		expect(d.deleted).toHaveLength(1);
		expect(d.moved).toHaveLength(0);
		expect(d.changed).toHaveLength(0);
	});

	it("已是孤儿的页不参与匹配，不会再被当作 deleted", () => {
		const prior = [
			entry({ id: "live", source_path: "g/a.md", source_hash: "h1" }),
			entry({ id: "orphan", source_path: "g/b.md", source_hash: "hb", orphaned_at: "2026-01-01T00:00:00.000Z" }),
		];
		const d = diffRaws(prior, [raw({ source_path: "g/a.md", source_hash: "h1" })]);
		expect(d.deleted).toHaveLength(0);
	});

	it("移动优先于把它当成 added+deleted（hash 配对先于 path）", () => {
		const prior = [entry({ id: "p1", source_path: "g/a.md", source_hash: "shared" })];
		// 一个文件移动到新路径
		const d = diffRaws(prior, [raw({ source_path: "g/moved.md", source_hash: "shared" })]);
		expect(d.moved).toHaveLength(1);
		expect(d.added).toHaveLength(0);
		expect(d.deleted).toHaveLength(0);
	});
});

describe("planOrphans", () => {
	const round = "2026-06-22T12:00:00.000Z";

	it("本轮新删除 → toMark；早于本轮的孤儿 → toReap（n+1）", () => {
		const manifest: Manifest = {
			version: 1,
			pages: [
				{
					id: "old",
					path: "old.md",
					source_path: "g/old.md",
					source_hash: "h",
					orphaned_at: "2026-06-22T11:00:00.000Z",
				},
				{ id: "live", path: "live.md", source_path: "g/live.md", source_hash: "h2", orphaned_at: null },
			],
		};
		const diff = {
			added: [],
			moved: [],
			changed: [],
			deleted: [{ type: "deleted" as const, id: "live", source_path: "g/live.md", source_hash: "h2" }],
		};
		const plan = planOrphans(manifest, diff, round);
		expect(plan.toReap.map((p) => p.id)).toEqual(["old"]);
		expect(plan.toMark.map((d) => d.id)).toEqual(["live"]);
	});

	it("本轮刚标记的孤儿（orphaned_at >= 本轮）不会立即回收", () => {
		const manifest: Manifest = {
			version: 1,
			pages: [{ id: "fresh", path: "f.md", source_path: "g/f.md", source_hash: "h", orphaned_at: round }],
		};
		const plan = planOrphans(manifest, { added: [], moved: [], changed: [], deleted: [] }, round);
		expect(plan.toReap).toHaveLength(0);
	});
});
