import { describe, expect, it } from "vitest";
import {
	appendSkillToken,
	insertSkillToken,
	mentionAtCursor,
	skillTokenText,
	splitPromptSegments,
} from "../src/board/prompt-tokens";

describe("skillTokenText", () => {
	it("裸写安全的名字不加引号，含空白 / 引号的名字加引号并剥掉引号字符", () => {
		expect(skillTokenText("写周报")).toBe("@skill:写周报");
		expect(skillTokenText("code review")).toBe('@skill:"code review"');
		expect(skillTokenText('a"b c')).toBe('@skill:"ab c"');
	});
});

describe("splitPromptSegments", () => {
	it("纯文本只有一个 text 段；空串也返回一个空 text 段", () => {
		expect(splitPromptSegments("hello")).toEqual([{ kind: "text", text: "hello" }]);
		expect(splitPromptSegments("")).toEqual([{ kind: "text", text: "" }]);
	});

	it("词首的 @skill token 被识别，裸写与引号形式都还原出名字", () => {
		expect(splitPromptSegments('用 @skill:写周报 和 @skill:"code review" 处理')).toEqual([
			{ kind: "text", text: "用 " },
			{ kind: "skill", text: "@skill:写周报", name: "写周报" },
			{ kind: "text", text: " 和 " },
			{ kind: "skill", text: '@skill:"code review"', name: "code review" },
			{ kind: "text", text: " 处理" },
		]);
	});

	it("非词首的 @skill 不误认（与宿主解析规则一致）", () => {
		expect(splitPromptSegments("mail@skill:x")).toEqual([{ kind: "text", text: "mail@skill:x" }]);
	});

	it("行首 token 也算词首", () => {
		expect(splitPromptSegments("@skill:a\n@skill:b")).toEqual([
			{ kind: "skill", text: "@skill:a", name: "a" },
			{ kind: "text", text: "\n" },
			{ kind: "skill", text: "@skill:b", name: "b" },
		]);
	});

	it("裸写名字被全角句读断开", () => {
		expect(splitPromptSegments("先跑 @skill:部署，再验收")).toEqual([
			{ kind: "text", text: "先跑 " },
			{ kind: "skill", text: "@skill:部署", name: "部署" },
			{ kind: "text", text: "，再验收" },
		]);
	});
});

describe("mentionAtCursor", () => {
	it("光标紧跟词首 @ 时返回提及上下文与检索词", () => {
		expect(mentionAtCursor("hi @", 4)).toEqual({ start: 3, query: "" });
		expect(mentionAtCursor("hi @dep", 7)).toEqual({ start: 3, query: "dep" });
		expect(mentionAtCursor("@x", 2)).toEqual({ start: 0, query: "x" });
	});

	it("@ 不在词首、或 @ 与光标之间有空白时不算提及", () => {
		expect(mentionAtCursor("mail@x", 6)).toBeNull();
		expect(mentionAtCursor("@x y", 4)).toBeNull();
		expect(mentionAtCursor("abc", 3)).toBeNull();
	});
});

describe("insertSkillToken / appendSkillToken", () => {
	it("提及替换：@检索词 被换成 token，后文没有空白时补一个空格", () => {
		const inserted = insertSkillToken("试试 @dep吧", 3, 7, "部署");
		expect(inserted.text).toBe("试试 @skill:部署 吧");
		expect(inserted.cursor).toBe(3 + "@skill:部署 ".length);
		// 后文本来就以空白开头：不重复补空格。
		const kept = insertSkillToken("试试 @dep 吧", 3, 7, "部署");
		expect(kept.text).toBe("试试 @skill:部署 吧");
		expect(kept.cursor).toBe(3 + "@skill:部署".length);
	});

	it("追加插入：光标不在词首时先补空格，保证 token 可被宿主还原", () => {
		expect(appendSkillToken("abc", 3, "x")).toEqual({ text: "abc @skill:x ", cursor: 13 });
		expect(appendSkillToken("abc ", 4, "x")).toEqual({ text: "abc @skill:x ", cursor: 13 });
		expect(appendSkillToken("", 0, "x")).toEqual({ text: "@skill:x ", cursor: 9 });
	});
});
