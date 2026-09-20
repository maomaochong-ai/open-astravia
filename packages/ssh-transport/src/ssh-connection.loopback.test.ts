import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLoopbackSshConnection } from "./testing.js";

function createRemoteDirectory(): string {
	return realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-")));
}

describe("SshConnection 的文件操作（经回环 SSH 跑在真实 shell 上）", () => {
	it("按范围读到的正是那一段字节，二进制内容不被改写", async () => {
		const dir = createRemoteDirectory();
		writeFileSync(join(dir, "data.bin"), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255, 0, 10]));
		const connection = createLoopbackSshConnection();

		expect([...(await connection.readFileRange(join(dir, "data.bin"), 3, 5))]).toEqual([3, 4, 5, 6, 7]);
		expect([...(await connection.readFileRange(join(dir, "data.bin"), 10, 100))]).toEqual([255, 0, 10]);
		expect([...(await connection.readFileHead(join(dir, "data.bin"), 2))]).toEqual([0, 1]);
	});

	it("写、读、改名、删除一个带空格与引号的文件", async () => {
		const dir = createRemoteDirectory();
		const connection = createLoopbackSshConnection();
		const original = join(dir, "it's a file.txt");

		await connection.writeFile(original, new TextEncoder().encode("hello"));
		expect(new TextDecoder().decode(await connection.readFile(original))).toBe("hello");

		await connection.rename(original, join(dir, "renamed.txt"));
		expect(readFileSync(join(dir, "renamed.txt"), "utf8")).toBe("hello");
		await expect(connection.stat(original)).resolves.toBeNull();

		await connection.remove(join(dir, "renamed.txt"));
		await expect(connection.stat(join(dir, "renamed.txt"))).resolves.toBeNull();
		// 删一个不存在的路径不算失败，与本机 rm(force) 同义。
		await expect(connection.remove(join(dir, "renamed.txt"))).resolves.toBeUndefined();
	});

	it("独占创建不覆盖已有文件；递归列举给出干净的相对路径", async () => {
		const dir = createRemoteDirectory();
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "src/a.ts"), "keep");
		const connection = createLoopbackSshConnection();

		await expect(connection.createEntry(join(dir, "src/a.ts"), "file")).resolves.toBe("exists");
		await expect(connection.createEntry(join(dir, "src/b.ts"), "file")).resolves.toBe("created");
		expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe("keep");
		const files = await connection.listFilesRecursive(dir, { ignoredDirectoryNames: [], limit: 100 });
		expect(files.sort()).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("拒绝删除远端根目录", async () => {
		await expect(createLoopbackSshConnection().remove("/")).rejects.toThrow(/root directory/);
	});
});
