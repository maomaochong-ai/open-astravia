import { splitStableMarkdownBlocks } from "@vetta-org/theme-ui/markdown";
import { describe, expect, it } from "vitest";

describe("splitStableMarkdownBlocks", () => {
	it("空行不提交段落，闭合围栏后才冻结前缀", () => {
		const prose = "First paragraph.\n\nSecond";
		expect(splitStableMarkdownBlocks(prose)).toEqual({ committed: [], tail: prose });

		const fenced = "```js\nconst a = 1;\n```\n\nmore";
		expect(splitStableMarkdownBlocks(fenced)).toEqual({
			committed: ["```js\nconst a = 1;\n```\n"],
			tail: "\nmore",
		});
	});
});
