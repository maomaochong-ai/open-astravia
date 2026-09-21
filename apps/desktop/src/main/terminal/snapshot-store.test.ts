import { mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApplicationCacheService } from "../cache/application-cache-service.js";
import {
	isSafeSnapshotId,
	TERMINAL_SNAPSHOT_MAX_BYTES,
	TerminalSnapshotStore,
	truncateSnapshot,
} from "./snapshot-store.js";

async function createStore(): Promise<{ store: TerminalSnapshotStore; rootDir: string }> {
	const cacheRoot = await mkdtemp(join(tmpdir(), "vetta-snapshot-"));
	const namespace = new ApplicationCacheService(cacheRoot).namespace("terminal-scrollback");
	return { store: new TerminalSnapshotStore(namespace), rootDir: namespace.rootDir };
}

describe("truncateSnapshot", () => {
	it("没超上限时原样返回", () => {
		expect(truncateSnapshot("hello", 32)).toBe("hello");
	});

	it("超限时只留尾部，并从行边界切开", () => {
		const text = ["第一行", "第二行", "第三行"].join("\n");

		const truncated = truncateSnapshot(text, 20);

		expect(truncated.endsWith("第三行")).toBe(true);
		// 从行边界切：半截 ANSI 序列会让回放出来的终端整屏错乱。
		expect(truncated.startsWith("第")).toBe(true);
		expect(truncated.includes("第一行")).toBe(false);
	});

	it("默认上限是 256KB", () => {
		expect(TERMINAL_SNAPSHOT_MAX_BYTES).toBe(256 * 1024);
	});
});

describe("isSafeSnapshotId", () => {
	it("挡住路径逃逸与空 id", () => {
		expect(isSafeSnapshotId("tab-1a2b")).toBe(true);
		expect(isSafeSnapshotId("../../etc/passwd")).toBe(false);
		expect(isSafeSnapshotId("a/b")).toBe(false);
		expect(isSafeSnapshotId("")).toBe(false);
	});
});

describe("TerminalSnapshotStore", () => {
	it("写入后能读回", async () => {
		const { store } = await createStore();

		await store.save("tab-1", "vetta-output");

		await expect(store.load("tab-1")).resolves.toBe("vetta-output");
	});

	it("没有快照时返回 undefined 而不是抛错", async () => {
		const { store } = await createStore();

		await expect(store.load("tab-missing")).resolves.toBeUndefined();
	});

	it("空内容等于删除，不留空文件", async () => {
		const { store, rootDir } = await createStore();
		await store.save("tab-1", "something");

		await store.save("tab-1", "");

		await expect(store.load("tab-1")).resolves.toBeUndefined();
		await expect(readdir(rootDir)).resolves.toEqual([]);
	});

	it("不安全的 id 既不写也不读，连目录都不建", async () => {
		const { store, rootDir } = await createStore();

		await store.save("../escape", "x");

		await expect(store.load("../escape")).resolves.toBeUndefined();
		await expect(readdir(rootDir)).rejects.toThrow(/ENOENT/);
	});

	it("总量超限时淘汰最旧的快照", async () => {
		const { store, rootDir } = await createStore();
		await store.save("tab-keep", "seed");
		// 直接铺一批超过总量上限的旧文件，再写一次触发淘汰。
		const chunk = "x".repeat(2 * 1024 * 1024);
		const old = Date.now() / 1000 - 3600;
		for (let index = 0; index < 9; index += 1) {
			const path = join(rootDir, `tab-old-${index}.txt`);
			await writeFile(path, chunk, "utf8");
			await utimes(path, old, old);
		}

		await store.save("tab-new", "fresh");

		const remaining = await readdir(rootDir);
		expect(remaining).toContain("tab-new.txt");
		expect(remaining.length).toBeLessThan(11);
	});
});
