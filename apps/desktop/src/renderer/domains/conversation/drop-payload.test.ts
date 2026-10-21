import { describe, expect, it } from "vitest";
import {
	ASTRAVIA_PATH_MIME,
	type DropTypeSnapshot,
	detectDropKind,
	parseFileUriList,
	readDropSnapshot,
} from "./drop-payload";

function snapshot(partial: Partial<DropTypeSnapshot>): DropTypeSnapshot {
	return { types: [], dropPhase: false, fileCount: 0, ...partial };
}

describe("detectDropKind", () => {
	it("优先识别文件树内部拖拽", () => {
		expect(detectDropKind(snapshot({ types: [ASTRAVIA_PATH_MIME, "Files"] }))).toBe("internal");
	});

	it("dragenter 阶段只靠 Files 类型判定", () => {
		expect(detectDropKind(snapshot({ types: ["Files"] }))).toBe("files");
		// 非 drop 阶段拿不到文件内容，普通浏览器外拖入的文本不算文件。
		expect(detectDropKind(snapshot({ types: ["text/plain"] }))).toBeNull();
	});

	it("drop 阶段用真实文件列表兜底 Windows 原生拖拽", () => {
		expect(detectDropKind(snapshot({ types: ["text/plain"], dropPhase: true, fileCount: 3 }))).toBe("files");
		expect(detectDropKind(snapshot({ types: ["text/uri-list"], dropPhase: true }))).toBe("files");
	});

	it("types 为空的拖拽按文件放行", () => {
		expect(detectDropKind(snapshot({ types: [] }))).toBe("files");
	});
});

describe("parseFileUriList", () => {
	it("解析 posix 路径并跳过注释行", () => {
		const paths = parseFileUriList("# comment\r\nfile:///Users/me/a%20b.txt\r\nfile:///Users/me/c.ts");
		expect(paths).toEqual(["/Users/me/a b.txt", "/Users/me/c.ts"]);
	});

	it("还原 Windows 盘符路径", () => {
		expect(parseFileUriList("file:///C:/work/dir/file.ts")).toEqual(["C:/work/dir/file.ts"]);
	});

	it("忽略非文件 URI 与非法内容", () => {
		expect(parseFileUriList("https://example.com/a\nfile://%E0%A4%A")).toEqual([]);
		expect(parseFileUriList("")).toEqual([]);
	});
});

describe("readDropSnapshot", () => {
	it("从 drop 事件读出类型与文件数", () => {
		const event = {
			type: "drop",
			dataTransfer: { types: ["Files"], files: [{ name: "a.ts" }] } as unknown as DataTransfer,
		};
		expect(readDropSnapshot(event)).toEqual({ types: ["Files"], dropPhase: true, fileCount: 1 });
	});

	it("dataTransfer 缺失时退化为空快照", () => {
		expect(readDropSnapshot({ type: "dragenter", dataTransfer: null })).toEqual({
			types: [],
			dropPhase: false,
			fileCount: 0,
		});
	});
});
