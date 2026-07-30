import { describe, expect, it } from "vitest";
import { parseInputSegments } from "./parse";
import { deriveAttachments, deriveSkillNames, segmentsToText } from "./serialize";
import type { InputSegment } from "./types";

describe("parseInputSegments", () => {
	it("穿插在文本流里的 skill 与文件 token 各自成段", () => {
		const { segments, legacyRef } = parseInputSegments("@skill:review 你好，帮我检查 @/Users/a/b.ts 有没有问题");
		expect(legacyRef).toBeNull();
		expect(segments).toEqual([
			{ kind: "skill", name: "review" },
			{ kind: "text", text: " 你好，帮我检查 " },
			{ kind: "file", path: "/Users/a/b.ts" },
			{ kind: "text", text: " 有没有问题" },
		]);
	});

	it("同一条消息里可以有多个 skill token", () => {
		const { segments } = parseInputSegments("@skill:review 检查完就 @skill:upload 上传");
		expect(deriveSkillNames(segments)).toEqual(["review", "upload"]);
	});

	it("中文名与带空格的路径用引号包裹", () => {
		const { segments } = parseInputSegments('@skill:"审查文件" 看 @"/Users/a/my file.ts"');
		expect(segments).toEqual([
			{ kind: "skill", name: "审查文件" },
			{ kind: "text", text: " 看 " },
			{ kind: "file", path: "/Users/a/my file.ts" },
		]);
	});

	it("图片扩展名归为 image 段", () => {
		const { segments } = parseInputSegments("@/tmp/shot.PNG");
		expect(segments).toEqual([{ kind: "image", path: "/tmp/shot.PNG" }]);
	});

	it("裸路径末尾的句读留给句子，不算进路径", () => {
		const { segments } = parseInputSegments("看下 @/Users/a/b.ts。还有别的吗？");
		expect(segments).toEqual([
			{ kind: "text", text: "看下 " },
			{ kind: "file", path: "/Users/a/b.ts" },
			{ kind: "text", text: "。还有别的吗？" },
		]);
	});

	it("非绝对路径与词中的 @ 一律保持文本", () => {
		const text = "联系 a@b.com 或看 @relative/path 以及 arr@idx";
		const { segments } = parseInputSegments(text);
		expect(segments).toEqual([{ kind: "text", text }]);
	});

	it("Windows 盘符与 UNC 路径识别为文件", () => {
		const { segments } = parseInputSegments("@C:/tmp/a.txt 和 @//share/b.txt");
		expect(segments.filter((s) => s.kind === "file")).toEqual([
			{ kind: "file", path: "C:/tmp/a.txt" },
			{ kind: "file", path: "//share/b.txt" },
		]);
	});

	it("旧会话的行首前缀还原成 legacyRef 与开头的 token", () => {
		const { segments, legacyRef } = parseInputSegments("/scene:release\n@/Users/a/b.ts\n@/tmp/shot.png\n帮我发版");
		expect(legacyRef).toEqual({ kind: "scene", name: "release" });
		expect(segments).toEqual([
			{ kind: "file", path: "/Users/a/b.ts" },
			{ kind: "image", path: "/tmp/shot.png" },
			{ kind: "text", text: "帮我发版" },
		]);
	});

	it("旧格式里手敲的 @ 行不当附件，留在正文", () => {
		const { segments, legacyRef } = parseInputSegments("/skill:review\n@这不是路径\n继续");
		expect(legacyRef).toEqual({ kind: "skill", name: "review" });
		expect(segments).toEqual([{ kind: "text", text: "@这不是路径\n继续" }]);
	});
});

describe("segmentsToText", () => {
	it("往返后 segments 不变；只在含空白时才加引号", () => {
		const text = '@skill:"审查文件" 检查 @/Users/a/b.ts 然后 @skill:upload 上传 @"/Users/a/my file.ts"';
		const { segments } = parseInputSegments(text);
		const roundTripped = segmentsToText(segments);
		// 中文名不含空白，回写时不再需要引号；语义等价即可，不要求字面相同。
		expect(roundTripped).toBe('@skill:审查文件 检查 @/Users/a/b.ts 然后 @skill:upload 上传 @"/Users/a/my file.ts"');
		expect(parseInputSegments(roundTripped).segments).toEqual(segments);
	});

	it("紧邻的 token 之间补空格，保证能被回读", () => {
		const segments: InputSegment[] = [
			{ kind: "skill", name: "review" },
			{ kind: "file", path: "/a/b.ts" },
			{ kind: "image", path: "/a/c.png" },
		];
		const text = segmentsToText(segments);
		expect(text).toBe("@skill:review @/a/b.ts @/a/c.png");
		// 补出来的空格是真实文本，回读时如实出现在段之间。
		expect(parseInputSegments(text).segments).toEqual([
			segments[0],
			{ kind: "text", text: " " },
			segments[1],
			{ kind: "text", text: " " },
			segments[2],
		]);
	});
});

describe("deriveAttachments", () => {
	it("按出现顺序去重并区分目录与图片", () => {
		const segments: InputSegment[] = [
			{ kind: "file", path: "/a/dir", isDirectory: true },
			{ kind: "image", path: "/a/c.png" },
			{ kind: "file", path: "/a/b.ts" },
			{ kind: "file", path: "/a/b.ts" },
		];
		expect(deriveAttachments(segments)).toEqual([
			{ kind: "directory", path: "/a/dir" },
			{ kind: "image", path: "/a/c.png" },
			{ kind: "file", path: "/a/b.ts" },
		]);
	});
});
