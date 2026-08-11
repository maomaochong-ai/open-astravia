/**
 * raws 目录读写锁：加工期间把 raws/ 整树设为只读（OS 级强制），
 * 任何方式（bash / 写工具 / 子进程）往里写文件都会失败，绝对杜绝 agent 污染。
 *
 * 仅 POSIX（macOS / Linux）有效——目录去掉写位即禁止在其中 create/rename/delete。
 * Windows 的只读属性不阻止在目录内建文件，故跳过（不做无效操作）。
 *
 * 但 UI 层由用户发起的写入是业务文件，不是脏数据：即使落在加工轮次中间也无妨，
 * 下一轮重建即可。OS chmod 区分不了 main 进程与 agent 子进程，故用一把进程内
 * 互斥锁把「加工锁的上/解锁」与「UI 特权写」串行化：UI 写时若正在加工，临时放开
 * 目标目录写位、写入、再锁回，窗口被互斥保护，agent 无从趁虚而入。
 */

import type { Dirent } from "node:fs";
import { chmod, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as knowledge from "@vetta/runtime-knowledge";
import { getAppLogger } from "../logger.js";
import { getKnowledgeRoot } from "./knowledge-layout.js";

const log = getAppLogger("kb-raws-lock");
const isPosix = process.platform !== "win32";

// 锁定：目录 r-x（0o555），文件 r--（0o444）。解锁：目录 0o755，文件 0o644。
const LOCK_DIR = 0o555;
const LOCK_FILE = 0o444;
const UNLOCK_DIR = 0o755;
const UNLOCK_FILE = 0o644;

async function chmodTree(dir: string, dirMode: number, fileMode: number): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return; // 目录不存在等，静默
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await chmodTree(full, dirMode, fileMode);
		} else if (entry.isFile()) {
			await chmod(full, fileMode).catch(() => {});
		}
	}
	await chmod(dir, dirMode).catch(() => {});
}

/** 把 raws/ 整树设为只读。无效平台或目录不存在则 no-op。 */
export async function lockRaws(root?: string): Promise<void> {
	if (!isPosix) {
		log.warn("raws read-only lock skipped: not effective on Windows");
		return;
	}
	const dir = knowledge.rawsDir(root ?? getKnowledgeRoot());
	await chmodTree(dir, LOCK_DIR, LOCK_FILE);
}

/** 恢复 raws/ 整树为可写。幂等，可在启动时自愈调用。 */
export async function unlockRaws(root?: string): Promise<void> {
	if (!isPosix) return;
	const dir = knowledge.rawsDir(root ?? getKnowledgeRoot());
	await chmodTree(dir, UNLOCK_DIR, UNLOCK_FILE);
}

// ---------- 进程内互斥：串行化加工锁切换与 UI 特权写 ----------

let chain: Promise<unknown> = Promise.resolve();
let roundActive = false;

/** 把任务排到互斥链尾，保证彼此不交叠执行。 */
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
	const result = chain.then(fn, fn);
	chain = result.then(
		() => {},
		() => {},
	);
	return result;
}

/** 加工轮开始：锁 raws 并标记轮次进行中（互斥，不与特权写交叠）。 */
export function beginRound(root?: string): Promise<void> {
	return runExclusive(async () => {
		await lockRaws(root);
		roundActive = true;
	});
}

/** 加工轮结束：解锁 raws 并清除标记（互斥）。 */
export function endRound(root?: string): Promise<void> {
	return runExclusive(async () => {
		roundActive = false;
		await unlockRaws(root);
	});
}

/**
 * UI 特权写：在互斥保护下执行写操作。
 * 若当前正在加工（raws 被锁），临时放开 dirs 的写位，写完按当前锁态恢复
 * （把 dirs 子树重新锁回只读，含本次新建文件）；否则 raws 本就可写，直接执行。
 *
 * @param dirs 本次写入需要可写的目录（其内 create/rename/delete 的父目录）。
 */
export function privilegedWrite<T>(dirs: string[], fn: () => Promise<T>): Promise<T> {
	return runExclusive(async () => {
		if (!isPosix || !roundActive) return fn();
		for (const d of dirs) await chmod(d, UNLOCK_DIR).catch(() => {});
		try {
			return await fn();
		} finally {
			for (const d of dirs) await chmodTree(d, LOCK_DIR, LOCK_FILE);
		}
	});
}
