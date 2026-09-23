import { describe, expect, it } from "vitest";
import { splitStableMarkdownBlocks } from "./stable-blocks";

describe("splitStableMarkdownBlocks", () => {
	it.each(["$$\n```\nformula\n```\n$$", "<html>\n```\npage\n```\n</html>"])(
		"rich blocks preserve parser context and previously frozen prefixes: %s",
		(rich) => {
			const prefix = "```ts\nconst x = 1;\n```\n";
			const text = `${prefix}\n${rich}\nAfter`;
			expect(splitStableMarkdownBlocks(text)).toEqual({ committed: [prefix], tail: `\n${rich}\nAfter` });
		},
	);
	it("空文本没有已提交块", () => {
		expect(splitStableMarkdownBlocks("")).toEqual({ committed: [], tail: "" });
	});

	it("只有一段未结束的段落全部留在 tail", () => {
		expect(splitStableMarkdownBlocks("Hello there")).toEqual({
			committed: [],
			tail: "Hello there",
		});
	});

	it("空行不提交段落，避免拆开松散列表和缩进代码", () => {
		const text = "First paragraph.\n\nSecond";
		expect(splitStableMarkdownBlocks(text)).toEqual({ committed: [], tail: text });
	});

	it("松散有序列表整段留在 tail", () => {
		const text = "1. foo\n\n2. bar\n";
		expect(splitStableMarkdownBlocks(text)).toEqual({ committed: [], tail: text });
	});

	it("闭合围栏后面没有正文时整块留在 tail", () => {
		const fence = "```js\nconst a = 1;\n```";
		expect(splitStableMarkdownBlocks(fence)).toEqual({ committed: [], tail: fence });
	});

	it("闭合围栏后面还有正文时提交围栏", () => {
		const text = "```js\nconst a = 1;\n```\n\nmore";
		expect(splitStableMarkdownBlocks(text)).toEqual({
			committed: ["```js\nconst a = 1;\n```\n"],
			tail: "\nmore",
		});
	});

	it("未闭合围栏整段留在 tail，即使中间有空行", () => {
		const text = "```js\nconst a = 1;\n\nconst b = 2;\n";
		expect(splitStableMarkdownBlocks(text)).toEqual({ committed: [], tail: text });
	});

	it("围栏闭合行后若还有非空白字符则不算闭合", () => {
		const text = "```js\nconst a = 1;\n``` notclose\nstill in fence";
		expect(splitStableMarkdownBlocks(text)).toEqual({ committed: [], tail: text });
	});

	it("info string 含反引号的行不能当作开围栏", () => {
		const text = "```js`oops\nnot a fence";
		expect(splitStableMarkdownBlocks(text)).toEqual({ committed: [], tail: text });
	});

	it("波浪线围栏的 info string 允许含波浪线", () => {
		const text = "~~~ a~b\ncode\n~~~\n\nafter";
		expect(splitStableMarkdownBlocks(text)).toEqual({
			committed: ["~~~ a~b\ncode\n~~~\n"],
			tail: "\nafter",
		});
	});

	it("波浪线围栏与反引号围栏互不闭合", () => {
		const text = "~~~\ncode\n```\nstill\n~~~\n\nafter";
		expect(splitStableMarkdownBlocks(text)).toEqual({
			committed: ["~~~\ncode\n```\nstill\n~~~\n"],
			tail: "\nafter",
		});
	});

	it("列表项里的缩进围栏不提交，避免把有序列表拆成两份文档", () => {
		const text = "1. first\n   ```js\n   x\n   ```\n2. second\n";
		expect(splitStableMarkdownBlocks(text)).toEqual({ committed: [], tail: text });
	});

	it("CRLF 闭合行仍能提交顶层围栏", () => {
		const text = "```js\r\nconst a = 1;\r\n```\r\n\r\nmore";
		expect(splitStableMarkdownBlocks(text)).toEqual({
			committed: ["```js\r\nconst a = 1;\r\n```\r\n"],
			tail: "\r\nmore",
		});
	});
});
