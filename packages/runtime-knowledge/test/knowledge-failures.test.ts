import { describe, expect, it } from "vitest";
import {
	applyQuarantine,
	attemptedFiles,
	clearFailures,
	EMPTY_FAILURES,
	type FailuresRecord,
	KB_MAX_PROCESSING_ATTEMPTS,
	quarantinedPaths,
	type RawsDiff,
	reconcileFailures,
} from "../src/index.js";

const emptyDiff = (): RawsDiff => ({ added: [], moved: [], changed: [], deleted: [] });

const NOW = "2026-06-22T00:00:00.000Z";

describe("knowledge failures（失败计数 + 隔离，按 source_path 记账）", () => {
	it("attemptedFiles：从 added/changed 抽出尝试加工的文件（added 用 raw.hash，changed 用 newHash）", () => {
		const diff: RawsDiff = {
			...emptyDiff(),
			added: [{ type: "added", raw: { source: "g", source_path: "g/a.md", source_hash: "ha", size: 1 } }],
			changed: [{ type: "changed", id: "id1", source_path: "g/b.md", oldHash: "old", newHash: "hb", source: "g" }],
		};
		expect(attemptedFiles(diff)).toEqual([
			{ source_hash: "ha", source_path: "g/a.md" },
			{ source_hash: "hb", source_path: "g/b.md" },
		]);
	});

	it("失败累计到阈值才隔离；未达阈值不隔离", () => {
		const attempted = [{ source_hash: "h", source_path: "g/x.pdf" }];
		const presentByPath = new Map<string, string>(); // wiki 始终没出现该路径的页 → 一直失败
		const currentRaws = new Map([["g/x.pdf", "h"]]);

		let rec: FailuresRecord = EMPTY_FAILURES;
		for (let i = 1; i < KB_MAX_PROCESSING_ATTEMPTS; i++) {
			rec = reconcileFailures({ failures: rec, attempted, presentByPath, currentRaws, now: NOW });
			expect(rec.entries["g/x.pdf"].attempts).toBe(i);
			expect(rec.entries["g/x.pdf"].quarantined).toBe(false);
			expect(quarantinedPaths(rec, currentRaws).has("g/x.pdf")).toBe(false);
		}
		// 第 KB_MAX_PROCESSING_ATTEMPTS 次 → 隔离
		rec = reconcileFailures({ failures: rec, attempted, presentByPath, currentRaws, now: NOW });
		expect(rec.entries["g/x.pdf"].attempts).toBe(KB_MAX_PROCESSING_ATTEMPTS);
		expect(rec.entries["g/x.pdf"].quarantined).toBe(true);
		expect(quarantinedPaths(rec, currentRaws).has("g/x.pdf")).toBe(true);
	});

	it("成功（该路径出现匹配 hash 的页）→ 清除失败记录", () => {
		const attempted = [{ source_hash: "h", source_path: "g/x.pdf" }];
		const currentRaws = new Map([["g/x.pdf", "h"]]);
		let rec = reconcileFailures({
			failures: EMPTY_FAILURES,
			attempted,
			presentByPath: new Map(),
			currentRaws,
			now: NOW,
		});
		expect(rec.entries["g/x.pdf"]).toBeDefined();
		// 下一轮成功：该路径有活跃页且 hash 一致
		rec = reconcileFailures({
			failures: rec,
			attempted,
			presentByPath: new Map([["g/x.pdf", "h"]]),
			currentRaws,
			now: NOW,
		});
		expect(rec.entries["g/x.pdf"]).toBeUndefined();
	});

	it("同 hash 不同路径的副本各自记账：一个写出页不会误清另一个的失败记录", () => {
		// 两份内容完全相同（同 hash）但路径不同的文件：x 写出了页、y 没有。
		const attempted = [
			{ source_hash: "h", source_path: "g/x.pdf" },
			{ source_hash: "h", source_path: "g/y.pdf" },
		];
		const currentRaws = new Map([
			["g/x.pdf", "h"],
			["g/y.pdf", "h"],
		]);
		const rec = reconcileFailures({
			failures: EMPTY_FAILURES,
			attempted,
			presentByPath: new Map([["g/x.pdf", "h"]]), // 只有 x 写出了页
			currentRaws,
			now: NOW,
		});
		expect(rec.entries["g/x.pdf"]).toBeUndefined(); // x 成功
		expect(rec.entries["g/y.pdf"].attempts).toBe(1); // y 仍被记失败（不被 x 误清）
	});

	it("剪枝：记录里的路径已不在当前 raws（删了/改名）→ 丢弃", () => {
		const stale: FailuresRecord = {
			version: 1,
			entries: {
				"g/x.pdf": {
					source_hash: "oldhash",
					source_path: "g/x.pdf",
					attempts: 5,
					first_failed_at: NOW,
					last_failed_at: NOW,
					quarantined: true,
				},
			},
		};
		const rec = reconcileFailures({
			failures: stale,
			attempted: [],
			presentByPath: new Map(),
			currentRaws: new Map([["g/other.pdf", "newhash"]]), // 旧路径已不在
			now: NOW,
		});
		expect(rec.entries["g/x.pdf"]).toBeUndefined();
	});

	it("剪枝：记录里的路径内容已变（hash 不同）→ 丢弃，视为可重试", () => {
		const stale: FailuresRecord = {
			version: 1,
			entries: {
				"g/x.pdf": {
					source_hash: "v1",
					source_path: "g/x.pdf",
					attempts: 3,
					first_failed_at: NOW,
					last_failed_at: NOW,
					quarantined: true,
				},
			},
		};
		const currentRaws = new Map([["g/x.pdf", "v2"]]); // 同路径但内容已变
		const rec = reconcileFailures({
			failures: stale,
			attempted: [],
			presentByPath: new Map(),
			currentRaws,
			now: NOW,
		});
		expect(rec.entries["g/x.pdf"]).toBeUndefined();
		expect(quarantinedPaths(stale, currentRaws).has("g/x.pdf")).toBe(false); // 隔离也因内容变而失效
	});

	it("applyQuarantine：剔除隔离的 added/changed（按 source_path），moved/deleted 不动", () => {
		const diff: RawsDiff = {
			added: [
				{ type: "added", raw: { source: "g", source_path: "g/a.md", source_hash: "qa", size: 1 } },
				{ type: "added", raw: { source: "g", source_path: "g/b.md", source_hash: "ok", size: 1 } },
			],
			changed: [{ type: "changed", id: "i", source_path: "g/c.md", oldHash: "o", newHash: "qc", source: "g" }],
			moved: [{ type: "moved", id: "m", from: "x", to: "y", source: "g", source_hash: "mh" }],
			deleted: [{ type: "deleted", id: "d", source_path: "g/d.md", source_hash: "dh" }],
		};
		const out = applyQuarantine(diff, new Set(["g/a.md", "g/c.md"]));
		expect(out.added.map((a) => a.raw.source_path)).toEqual(["g/b.md"]);
		expect(out.changed).toHaveLength(0);
		expect(out.moved).toHaveLength(1);
		expect(out.deleted).toHaveLength(1);
	});

	it("clearFailures：指定 source_path 清除；不传则清空全部", () => {
		const rec: FailuresRecord = {
			version: 1,
			entries: {
				"g/a.pdf": {
					source_hash: "h1",
					source_path: "g/a.pdf",
					attempts: 3,
					first_failed_at: NOW,
					last_failed_at: NOW,
					quarantined: true,
				},
				"g/b.pdf": {
					source_hash: "h2",
					source_path: "g/b.pdf",
					attempts: 3,
					first_failed_at: NOW,
					last_failed_at: NOW,
					quarantined: true,
				},
			},
		};
		expect(clearFailures(rec, new Set(["g/a.pdf"])).entries).toEqual({ "g/b.pdf": rec.entries["g/b.pdf"] });
		expect(clearFailures(rec).entries).toEqual({});
	});
});
