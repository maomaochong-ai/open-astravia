import { describe, expect, it } from "vitest";
import type { FileEditorDocumentState } from "./file-atoms";
import { pruneEditorDocuments } from "./file-atoms";

function doc(path: string, content: string, draft = content): FileEditorDocumentState {
	return {
		path,
		savedContent: content,
		draftContent: draft,
		revision: "r1",
		hasBom: false,
		lineEnding: "lf",
		size: content.length,
		modifiedAt: 0,
		editorGeneration: 0,
	};
}

function documents(count: number): Map<string, FileEditorDocumentState> {
	const map = new Map<string, FileEditorDocumentState>();
	for (let i = 0; i < count; i += 1) map.set(`/ws/f${i}.ts`, doc(`/ws/f${i}.ts`, `content ${i}`));
	return map;
}

describe("编辑器文档裁剪", () => {
	it("超过上限时按最近使用丢最旧的干净文档", () => {
		const trimmed = pruneEditorDocuments(documents(12), 8);
		expect(trimmed.size).toBe(8);
		// Map 的插入顺序就是使用顺序，最早的四个被丢掉
		expect([...trimmed.keys()]).toEqual([
			"/ws/f4.ts",
			"/ws/f5.ts",
			"/ws/f6.ts",
			"/ws/f7.ts",
			"/ws/f8.ts",
			"/ws/f9.ts",
			"/ws/f10.ts",
			"/ws/f11.ts",
		]);
	});

	it("有未保存改动的文档一张都不丢", () => {
		const map = documents(12);
		// 最旧的几份都改成脏的：它们必须留下来，宁可不裁
		for (const path of ["/ws/f0.ts", "/ws/f1.ts", "/ws/f2.ts", "/ws/f3.ts", "/ws/f4.ts"]) {
			map.set(path, doc(path, "saved", "unsaved draft"));
		}
		const trimmed = pruneEditorDocuments(map, 8);
		for (const path of ["/ws/f0.ts", "/ws/f1.ts", "/ws/f2.ts", "/ws/f3.ts", "/ws/f4.ts"]) {
			expect(trimmed.has(path), path).toBe(true);
		}
		expect(trimmed.size).toBe(8);
	});

	it("没超过上限时原样返回同一个 Map，不做无意义的重建", () => {
		const map = documents(3);
		expect(pruneEditorDocuments(map, 8)).toBe(map);
	});
});
