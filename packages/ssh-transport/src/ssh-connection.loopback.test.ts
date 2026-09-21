import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it as baseIt, describe, expect } from "vitest";
import { SshRemoteCommandError } from "./errors.js";
import type { SshConnection } from "./ssh-connection.js";
import { buildSshHelperForTests, createLoopbackSshConnection } from "./testing.js";

function createRemoteDirectory(): string {
	return realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-")));
}

const helperBinary = buildSshHelperForTests();

/**
 * 同一组行为在两条路上各跑一遍：每次操作新起一个 ssh 进程的 `ssh exec`，以及经远端 helper
 * 的常驻通道。调用方不该分得出区别——helper 只是更快，不是另一套语义。
 */
const modes: { name: string; skip: boolean; connect: () => Promise<SshConnection> }[] = [
	{ name: "ssh exec", skip: false, connect: async () => createLoopbackSshConnection() },
	{
		name: "远端 helper",
		skip: !helperBinary,
		connect: async () => {
			const connection = createLoopbackSshConnection("loopback", { helper: { resolveBinary: () => helperBinary } });
			if (!(await connection.helper())) throw new Error("helper did not come up");
			return connection;
		},
	},
];

describe.each(modes)("SshConnection 的文件操作（回环 SSH，$name）", ({ skip, connect }) => {
	const it = skip ? baseIt.skip : baseIt;

	it("目录列举与 stat 给出同样形状的条目，符号链接可选择跟随", async () => {
		const dir = createRemoteDirectory();
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "a.txt"), "hello");
		symlinkSync(join(dir, "a.txt"), join(dir, "link.txt"));
		const connection = await connect();

		const entries = await connection.listDirectory(dir);
		expect(entries.map((entry) => [entry.name, entry.kind]).sort()).toEqual([
			["a.txt", "file"],
			["link.txt", "symlink"],
			["src", "directory"],
		]);
		expect(entries.find((entry) => entry.name === "a.txt")).toMatchObject({ sizeBytes: 5 });
		await expect(connection.stat(join(dir, "link.txt"))).resolves.toMatchObject({
			name: "link.txt",
			kind: "symlink",
		});
		await expect(connection.stat(join(dir, "link.txt"), undefined, { followSymlinks: true })).resolves.toMatchObject({
			kind: "file",
		});
		await expect(connection.realPath(join(dir, "link.txt"))).resolves.toBe(join(dir, "a.txt"));
		await expect(connection.realPath(join(dir, "missing"))).resolves.toBe(join(dir, "missing"));
	});

	it("读一个不存在的文件是「远端答复了没有」，不是传输故障", async () => {
		const connection = await connect();
		await expect(connection.readFile(join(createRemoteDirectory(), "missing.txt"))).rejects.toBeInstanceOf(
			SshRemoteCommandError,
		);
	});

	it("按范围读到的正是那一段字节，二进制内容不被改写", async () => {
		const dir = createRemoteDirectory();
		writeFileSync(join(dir, "data.bin"), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255, 0, 10]));
		const connection = await connect();

		expect([...(await connection.readFileRange(join(dir, "data.bin"), 3, 5))]).toEqual([3, 4, 5, 6, 7]);
		expect([...(await connection.readFileRange(join(dir, "data.bin"), 10, 100))]).toEqual([255, 0, 10]);
		expect([...(await connection.readFileHead(join(dir, "data.bin"), 2))]).toEqual([0, 1]);
	});

	it("写、读、改名、删除一个带空格与引号的文件", async () => {
		const dir = createRemoteDirectory();
		const connection = await connect();
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
		const connection = await connect();

		await expect(connection.createEntry(join(dir, "src/a.ts"), "file")).resolves.toBe("exists");
		await expect(connection.createEntry(join(dir, "src/b.ts"), "file")).resolves.toBe("created");
		expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe("keep");
		const files = await connection.listFilesRecursive(dir, { ignoredDirectoryNames: [], limit: 100 });
		expect(files.sort()).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("拒绝删除远端根目录", async () => {
		await expect((await connect()).remove("/")).rejects.toThrow(/root directory/);
	});
});

/**
 * 端口扫描只能在真实的机器上验证：用哪个工具、输出长什么样，都由那台机器决定。回环夹具把
 * 「远端」指向本机，于是这里起一个真的监听端口，再看扫描能不能认出它——测的是命令与解析
 * 在这个平台上确实对得上，而不是我们拼出了预期的字符串。
 */
describe("列出远端正在监听的端口（回环 SSH）", () => {
	baseIt("认出一个刚起的监听端口，并且不列出 sshd 的 22", async () => {
		const server = createServer();
		const port = await new Promise<number>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (address && typeof address === "object") resolve(address.port);
				else reject(new Error("no port"));
			});
		});
		try {
			const ports = await createLoopbackSshConnection().listListeningPorts();
			expect(ports.map((entry) => entry.port)).toContain(port);
			expect(ports.map((entry) => entry.port)).not.toContain(22);
			// 端口号升序是界面直接用的顺序，不能只保证集合正确。
			expect(ports.map((entry) => entry.port)).toEqual([...ports.map((entry) => entry.port)].sort((a, b) => a - b));
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
