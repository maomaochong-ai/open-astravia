import { describe, expect, test } from "vitest";
import { resolveChatFilePath } from "./resolve-chat-file-path";

describe("resolveChatFilePath", () => {
	test("keeps posix absolute", () => {
		expect(resolveChatFilePath("/tmp/a.ts", "/home/proj")).toBe("/tmp/a.ts");
	});

	test("keeps windows absolute", () => {
		expect(resolveChatFilePath("C:/Users/u/a.ts", "C:/Users/u/proj")).toBe("C:/Users/u/a.ts");
	});

	test("strips leading slash before windows drive", () => {
		expect(resolveChatFilePath("/C:/Users/u/a.ts", "C:/Users/u/proj")).toBe("C:/Users/u/a.ts");
	});

	test("resolves relative against cwd", () => {
		expect(resolveChatFilePath("src/index.ts", "C:/Users/u/proj")).toBe("C:/Users/u/proj/src/index.ts");
		expect(resolveChatFilePath("./docs/a.md", "/home/proj")).toBe("/home/proj/docs/a.md");
	});

	test("normalizes backslashes", () => {
		expect(resolveChatFilePath("C:\\Users\\u\\a.ts", null)).toBe("C:/Users/u/a.ts");
	});
});
