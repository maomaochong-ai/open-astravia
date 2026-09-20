import { describe, expect, it } from "vitest";
import { parseRemoteDirectoryListing } from "./directory-listing.js";

describe("远端目录列举的解析", () => {
	it("解析出类型、大小、修改时间，并去掉 find 的 ./ 前缀", () => {
		const output = "directory\t4096\t1700000000\t./src\nregular file\t12\t1700000001\t./a b.txt\n";

		expect(parseRemoteDirectoryListing(output)).toEqual([
			{ name: "src", kind: "directory", sizeBytes: 4096, modifiedAtSeconds: 1700000000 },
			{ name: "a b.txt", kind: "file", sizeBytes: 12, modifiedAtSeconds: 1700000001 },
		]);
	});

	it("认得 BSD 的首字母大写写法", () => {
		expect(parseRemoteDirectoryListing("Directory\t4096\t1\t./src")[0]?.kind).toBe("directory");
	});

	it("兜住中文 locale 的输出", () => {
		// 命令侧已经用 LC_ALL=C 锁死英文；这里是第二道闸——漏掉 locale 时整个目录会被
		// 判成未知类型，界面显示为空且不报错，从现象反推不到原因。
		expect(parseRemoteDirectoryListing("目录\t4096\t1789697082\t./admin123")[0]).toEqual({
			name: "admin123",
			kind: "directory",
			sizeBytes: 4096,
			modifiedAtSeconds: 1789697082,
		});
	});

	it("软链接单独成类，不与普通文件混为一谈", () => {
		// 指向目录的软链接很常见；按普通文件处理会让这些目录在选择器里消失。
		expect(parseRemoteDirectoryListing("symbolic link\t10\t1\t./data")[0]?.kind).toBe("symlink");
	});

	it("丢掉解析不出的碎片，保住其余条目", () => {
		// 文件名里带换行会切出无法解析的行；整个目录因此打不开比少一个条目更糟。
		const output = "garbage\ndirectory\t4096\t1\t./src\n";
		expect(parseRemoteDirectoryListing(output).map((entry) => entry.name)).toEqual(["src"]);
	});

	it("跳过 . 与 ..", () => {
		expect(parseRemoteDirectoryListing("directory\t4096\t1\t./.\ndirectory\t4096\t1\t./..")).toEqual([]);
	});
});
