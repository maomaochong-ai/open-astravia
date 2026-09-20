import { beforeEach, describe, expect, it, vi } from "vitest";

const listDirectory = vi.fn();
const stat = vi.fn();
const readFile = vi.fn();
const writeFile = vi.fn();

vi.mock("../ssh/ssh-runtime.js", () => ({
	getSshConnection: () => ({ listDirectory, stat, readFile, writeFile }),
}));

const { allowRemoteProjectRoot, readRemoteDirectory, readRemoteEditableTextFile, saveRemoteEditableTextFile } =
	await import("./remote-filesystem.js");

function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

describe("远程文件的授权边界", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		allowRemoteProjectRoot("ssh://build-01/srv/app");
	});

	it("项目目录内的路径放行", async () => {
		listDirectory.mockResolvedValueOnce([]);
		await expect(readRemoteDirectory("ssh://build-01/srv/app/src")).resolves.toEqual([]);
	});

	it("拒绝跳出项目目录的路径", async () => {
		await expect(readRemoteDirectory("ssh://build-01/etc")).rejects.toThrow("outside any known project");
		expect(listDirectory).not.toHaveBeenCalled();
	});

	it("拒绝靠共同前缀蹭进来的兄弟目录", async () => {
		// `/srv/app-secrets` 以 `/srv/app` 开头，只比较前缀就会被误放行。
		await expect(readRemoteDirectory("ssh://build-01/srv/app-secrets")).rejects.toThrow("outside any known project");
	});

	it("同路径但不同主机不算已授权", async () => {
		await expect(readRemoteDirectory("ssh://other/srv/app/src")).rejects.toThrow("outside any known project");
	});

	it("远端路径大小写敏感，App 不等于已授权的 app", async () => {
		await expect(readRemoteDirectory("ssh://build-01/srv/App/src")).rejects.toThrow("outside any known project");
	});
});

describe("远程目录列举", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		allowRemoteProjectRoot("ssh://build-01/srv/app");
	});

	it("目录排在前面，条目带回可继续展开的 URI，时间换算成毫秒", async () => {
		listDirectory.mockResolvedValueOnce([
			{ name: "readme.md", kind: "file", sizeBytes: 12, modifiedAtSeconds: 1700000000 },
			{ name: "src", kind: "directory", sizeBytes: 4096, modifiedAtSeconds: 1700000001 },
		]);

		await expect(readRemoteDirectory("ssh://build-01/srv/app")).resolves.toEqual([
			{
				name: "src",
				path: "ssh://build-01/srv/app/src",
				isDirectory: true,
				size: 4096,
				modifiedAt: 1700000001000,
			},
			{
				name: "readme.md",
				path: "ssh://build-01/srv/app/readme.md",
				isDirectory: false,
				size: 12,
				modifiedAt: 1700000000000,
			},
		]);
	});
});

describe("远程文件编辑", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		allowRemoteProjectRoot("ssh://build-01/srv/app");
	});

	it("超过大小上限的文件在传输前就被挡住", async () => {
		// 先按远端报的大小拒绝，而不是把几百兆拖过网络再说。
		stat.mockResolvedValueOnce({ name: "big.log", kind: "file", sizeBytes: 50 * 1024 * 1024, modifiedAtSeconds: 1 });

		await expect(readRemoteEditableTextFile("ssh://build-01/srv/app/big.log")).rejects.toThrow();
		expect(readFile).not.toHaveBeenCalled();
	});

	it("保存前重新读远端算修订号，被别人改过就报冲突且不写入", async () => {
		readFile.mockResolvedValueOnce(encode("别人改过的内容"));

		await expect(
			saveRemoteEditableTextFile("ssh://build-01/srv/app/a.txt", "我的内容", {
				expectedRevision: "打开时的旧修订号",
				hasBom: false,
			}),
		).resolves.toMatchObject({ status: "conflict" });
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("修订号一致时写入并返回新修订号", async () => {
		const current = encode("原内容");
		readFile.mockResolvedValueOnce(current);
		stat.mockResolvedValueOnce({ name: "a.txt", kind: "file", sizeBytes: 9, modifiedAtSeconds: 1700000002 });
		const { getFileRevision } = await import("./editable-text.js");

		const result = await saveRemoteEditableTextFile("ssh://build-01/srv/app/a.txt", "新内容", {
			expectedRevision: getFileRevision(Buffer.from(current)),
			hasBom: false,
		});

		expect(result.status).toBe("saved");
		expect(writeFile).toHaveBeenCalledWith("/srv/app/a.txt", Buffer.from(encode("新内容")));
	});
});
