import { describe, expect, it } from "vitest";
import { getRenameNameProblem } from "./rename-name";

const siblings = [
	{ name: "main.ts", path: "/ws/src/main.ts" },
	{ name: "README.md", path: "/ws/src/README.md" },
];

describe("getRenameNameProblem", () => {
	it("按平台规则拒绝非法名字", () => {
		expect(
			getRenameNameProblem({
				caseInsensitive: true,
				newName: "a/b.ts",
				oldPath: "/ws/src/main.ts",
				siblings,
				windows: true,
			}),
		).toEqual({
			kind: "invalid",
			issue: "path-separator",
		});
		expect(
			getRenameNameProblem({
				caseInsensitive: false,
				newName: "a?b.ts",
				oldPath: "/ws/src/main.ts",
				siblings,
				windows: true,
			}),
		).toEqual({
			kind: "invalid",
			issue: "invalid-character",
		});
		// 非 Windows 上 `?` 是合法文件名。
		expect(
			getRenameNameProblem({
				caseInsensitive: false,
				newName: "a?b.ts",
				oldPath: "/ws/src/main.ts",
				siblings,
				windows: false,
			}),
		).toBeNull();
	});

	it("拦下与同级条目重名的改名", () => {
		expect(
			getRenameNameProblem({
				caseInsensitive: false,
				newName: "README.md",
				oldPath: "/ws/src/main.ts",
				siblings,
				windows: false,
			}),
		).toEqual({
			kind: "exists",
		});
	});

	it("大小写不敏感的文件系统上换大小写也会撞名", () => {
		expect(
			getRenameNameProblem({
				caseInsensitive: true,
				newName: "readme.md",
				oldPath: "/ws/src/main.ts",
				siblings,
				windows: false,
			}),
		).toEqual({
			kind: "exists",
		});
		expect(
			getRenameNameProblem({
				caseInsensitive: false,
				newName: "readme.md",
				oldPath: "/ws/src/main.ts",
				siblings,
				windows: false,
			}),
		).toBeNull();
	});

	it("忽略它自己，也容忍目录还没列出来的情况", () => {
		expect(
			getRenameNameProblem({
				caseInsensitive: true,
				newName: "main.ts",
				oldPath: "/ws/src/main.ts",
				siblings,
				windows: false,
			}),
		).toBeNull();
		expect(
			getRenameNameProblem({
				caseInsensitive: true,
				newName: "anything.ts",
				oldPath: "/ws/src/main.ts",
				siblings: undefined,
				windows: false,
			}),
		).toBeNull();
	});
});
