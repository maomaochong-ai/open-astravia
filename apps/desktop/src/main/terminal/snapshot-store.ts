import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ApplicationCacheNamespace, getApplicationCacheService } from "../cache/application-cache-service.js";

/**
 * 终端的回滚缓冲快照。
 *
 * 为什么不放渲染进程的 localStorage：单个终端的 serialize 结果有几百 KB，两三个 tab
 * 就能把 origin 配额打满，而 `setItem` 失败会落在**无关功能**上（活动面板宽度突然
 * 存不进去）。快照是「丢了只是终端回来时是空的」的可丢弃数据，正好符合缓存契约：
 * 删掉整个 namespace 不影响任何正式功能。
 */

export const TERMINAL_SNAPSHOT_NAMESPACE = "terminal-scrollback";

/** 单份快照上限；超出的从头截断，只留尾部。 */
export const TERMINAL_SNAPSHOT_MAX_BYTES = 256 * 1024;

/** 全部快照的总量上限，超出按最后写入时间淘汰最旧的。 */
export const TERMINAL_SNAPSHOT_TOTAL_MAX_BYTES = 16 * 1024 * 1024;

/** tabId 是 uuid 形状；拼进文件名前必须挡住路径逃逸。 */
const SAFE_TAB_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeSnapshotId(tabId: string): boolean {
	return SAFE_TAB_ID.test(tabId);
}

/**
 * 超长时保留尾部并从行边界切，避免把一行 ANSI 序列切成两半——
 * 半截转义序列会让回放出来的终端整屏错乱。
 */
export function truncateSnapshot(text: string, maxBytes = TERMINAL_SNAPSHOT_MAX_BYTES): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let tail = Buffer.from(text, "utf8").subarray(-maxBytes).toString("utf8");
	const firstNewline = tail.indexOf("\n");
	if (firstNewline >= 0) tail = tail.slice(firstNewline + 1);
	return tail;
}

export class TerminalSnapshotStore {
	private readonly namespace: ApplicationCacheNamespace;

	constructor(namespace?: ApplicationCacheNamespace) {
		this.namespace = namespace ?? getApplicationCacheService().namespace(TERMINAL_SNAPSHOT_NAMESPACE);
	}

	async save(tabId: string, text: string): Promise<void> {
		if (!isSafeSnapshotId(tabId)) return;
		await this.namespace.ensure();
		const payload = truncateSnapshot(text);
		if (!payload) {
			await this.remove(tabId);
			return;
		}
		await writeFile(this.namespace.path(`${tabId}.txt`), payload, "utf8");
		await this.enforceTotalLimit();
	}

	async load(tabId: string): Promise<string | undefined> {
		if (!isSafeSnapshotId(tabId)) return undefined;
		try {
			return await readFile(this.namespace.path(`${tabId}.txt`), "utf8");
		} catch {
			// 没有快照是正常情况（第一次打开、缓存被清过）。
			return undefined;
		}
	}

	async remove(tabId: string): Promise<void> {
		if (!isSafeSnapshotId(tabId)) return;
		await rm(this.namespace.path(`${tabId}.txt`), { force: true });
	}

	/** 总量超限时丢最旧的；快照可丢弃，所以淘汰不需要通知任何人。 */
	private async enforceTotalLimit(): Promise<void> {
		let entries: string[];
		try {
			entries = await readdir(this.namespace.rootDir);
		} catch {
			return;
		}
		const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
		for (const entry of entries) {
			if (!entry.endsWith(".txt")) continue;
			const path = join(this.namespace.rootDir, entry);
			try {
				const info = await stat(path);
				files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
			} catch {
				// 并发清理时文件可能刚被删掉，跳过即可。
			}
		}
		let total = files.reduce((sum, file) => sum + file.size, 0);
		if (total <= TERMINAL_SNAPSHOT_TOTAL_MAX_BYTES) return;
		files.sort((left, right) => left.mtimeMs - right.mtimeMs);
		for (const file of files) {
			if (total <= TERMINAL_SNAPSHOT_TOTAL_MAX_BYTES) break;
			await rm(file.path, { force: true });
			total -= file.size;
		}
	}
}
