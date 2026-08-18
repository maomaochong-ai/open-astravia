import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// 日志保留策略：在原"按日期保留"基础上，叠加"归档数 + 总字节"双上限，封顶单
// type 目录磁盘占用。删除优先级：① 日期过期（含归档与历史活跃文件）→ ② 归档数
// 超限（删最旧归档）→ ③ 总字节超限（删最旧归档）。
//
// 关键：数量/字节上限只回收**归档文件**（轮转产生、名含 `.size`/`.migration` 段），
// 绝不删任何进程**当日正在写入的活跃文件**。多进程共写同一 type 目录，GUI 与各
// sidecar/CLI 的当日活跃文件形如 `<date>.log` / `<date>.<role>.<pid>.log`（无 reason
// 段）；若按"精确文件名"只保护本进程自己的活跃文件，A 进程清理时会把 B 进程当日
// 活跃文件误当归档删掉——这正是角色化隔离本想消除的竞态。故按"是否归档"判定保护。

export interface RetentionOptions {
	retentionDays: number;
	maxTotalBytes: number;
	maxArchiveCount: number;
	// 今日日期键（formatChinaDateKey(new Date())）。当日的非归档文件即任一进程正在
	// 写入的活跃文件，数量/字节上限永不回收。
	currentDateKey: string;
}

interface LogFileEntry {
	path: string;
	size: number;
	mtimeMs: number;
	date?: string;
	isArchive: boolean;
	isActive: boolean;
}

export function enforceRetention(dir: string, opts: RetentionOptions): void {
	try {
		const entries = collect(dir, opts.currentDateKey);
		// 日期过期对所有文件生效；当日文件的日期恒在保留窗口内，活跃文件自然不受影响。
		deleteByDate(entries, opts.retentionDays);
		enforceArchiveCount(entries, opts.maxArchiveCount);
		enforceTotalBytes(entries, opts.maxTotalBytes);
	} catch {
		// Best effort cleanup only.
	}
}

// 归档文件名总带轮转 reason 段（`.size` 或 `.migration`）；活跃文件名（`<date>.log`
// 或 `<date>.<role>.<pid>.log`）没有。role 取值固定、pid 为数字，均不含这些 token。
function isArchiveName(filename: string): boolean {
	return filename.includes(".size.") || filename.includes(".migration.");
}

function collect(dir: string, currentDateKey: string): LogFileEntry[] {
	const entries: LogFileEntry[] = [];
	for (const filename of readdirSync(dir)) {
		if (!filename.endsWith(".log")) continue;
		const path = join(dir, filename);
		try {
			const stat = statSync(path);
			const date = /^(\d{4}-\d{2}-\d{2})(?:\.|$)/.exec(filename)?.[1];
			const archive = isArchiveName(filename);
			entries.push({
				path,
				size: stat.size,
				mtimeMs: stat.mtimeMs,
				date,
				isArchive: archive,
				// 当日非归档 = 某进程正在写入的活跃文件，数量/字节上限永不删。
				isActive: !archive && date === currentDateKey,
			});
		} catch {
			// File vanished between readdir and stat; skip.
		}
	}
	return entries;
}

function remove(entries: LogFileEntry[], entry: LogFileEntry): void {
	try {
		unlinkSync(entry.path);
	} catch {
		// Already gone or locked; drop from accounting regardless.
	}
	const index = entries.indexOf(entry);
	if (index >= 0) entries.splice(index, 1);
}

function deleteByDate(entries: LogFileEntry[], retentionDays: number): void {
	const dated = entries.filter((entry) => entry.date !== undefined);
	const retainedDates = new Set(
		[...new Set(dated.map((entry) => entry.date))]
			.sort((left, right) => (right ?? "").localeCompare(left ?? ""))
			.slice(0, retentionDays),
	);
	for (const entry of [...entries]) {
		if (entry.date === undefined) continue;
		if (!retainedDates.has(entry.date)) remove(entries, entry);
	}
}

// 仅归档文件可被数量/字节上限回收；活跃文件排除在外。
function reclaimableOldestFirst(entries: LogFileEntry[]): LogFileEntry[] {
	return entries.filter((entry) => !entry.isActive).sort((left, right) => left.mtimeMs - right.mtimeMs);
}

function enforceArchiveCount(entries: LogFileEntry[], maxArchiveCount: number): void {
	const reclaimable = reclaimableOldestFirst(entries);
	let removable = reclaimable.length - maxArchiveCount;
	for (let index = 0; index < reclaimable.length && removable > 0; index += 1, removable -= 1) {
		remove(entries, reclaimable[index]);
	}
}

function enforceTotalBytes(entries: LogFileEntry[], maxTotalBytes: number): void {
	let total = entries.reduce((sum, entry) => sum + entry.size, 0);
	if (total <= maxTotalBytes) return;
	for (const entry of reclaimableOldestFirst(entries)) {
		if (total <= maxTotalBytes) break;
		total -= entry.size;
		remove(entries, entry);
	}
}
