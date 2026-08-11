import { describe, expect, it } from "vitest";
import {
	type AddedChange,
	buildProcessingPrompt,
	type ChangedChange,
	diffNeedsProcessing,
	type RawFile,
	type RawsDiff,
} from "../src/index.js";

const emptyDiff = (): RawsDiff => ({ added: [], moved: [], changed: [], deleted: [] });

const added = (over: Partial<RawFile> = {}): AddedChange => ({
	type: "added",
	raw: { source: "g", source_path: "g/a.md", source_hash: "h1", size: 0, ...over },
});

const changed = (id: string): ChangedChange => ({
	type: "changed",
	id,
	source_path: "g/a.md",
	oldHash: "h0",
	newHash: "h1",
	source: "g",
});

describe("diffNeedsProcessing", () => {
	it("空 diff → 无需 LLM", () => {
		expect(diffNeedsProcessing(emptyDiff())).toBe(false);
	});

	it("仅 moved（纯元数据）→ 无需 LLM", () => {
		const d = emptyDiff();
		d.moved.push({ type: "moved", id: "x", from: "g/a.md", to: "g/b.md", source: "g", source_hash: "h1" });
		expect(diffNeedsProcessing(d)).toBe(false);
	});

	it("仅 deleted（标孤儿，工程处理）→ 无需 LLM", () => {
		const d = emptyDiff();
		d.deleted.push({ type: "deleted", id: "x", source_path: "g/a.md", source_hash: "h1" });
		expect(diffNeedsProcessing(d)).toBe(false);
	});

	it("有 added → 需要 LLM", () => {
		const d = emptyDiff();
		d.added.push(added());
		expect(diffNeedsProcessing(d)).toBe(true);
	});

	it("有 changed → 需要 LLM", () => {
		const d = emptyDiff();
		d.changed.push(changed("id-1"));
		expect(diffNeedsProcessing(d)).toBe(true);
	});
});

describe("buildProcessingPrompt", () => {
	it("含 added/changed 段，且不含任何孤儿/回收指引", () => {
		const d = emptyDiff();
		d.added.push(added({ source_path: "g/new.md", source_hash: "hx" }));
		d.changed.push(changed("id-9"));
		const prompt = buildProcessingPrompt(d, "/tmp/kb", "/tmp/work");
		expect(prompt).toContain("新增文件");
		expect(prompt).toContain("内容变更文件");
		expect(prompt).toContain("g/new.md");
		expect(prompt).toContain('id="id-9"');
		// 孤儿删除是纯工程动作，绝不进 agent 任务。
		expect(prompt).not.toContain("孤儿");
		expect(prompt).not.toContain("回收");
	});
});
