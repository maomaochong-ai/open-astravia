import { existsSync, readdirSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { app } from "electron";
import { logRingBuffer } from "./logger/log-ring-buffer.js";
import { APP_LOG_TYPE_LIST, getAppLogBaseDir } from "./logger.js";

// 单个诊断包内日志文件的总字节预算：足够带出最近上下文，又不至于产出超大 zip。
const MAX_LOG_BYTES = 20 * 1024 * 1024;
// 每个 type 目录最多纳入的文件数（按 mtime 取最新）。
const MAX_FILES_PER_TYPE = 6;

export interface DiagnosticsBundleResult {
	zipPath: string;
	sizeBytes: number;
}

// 打包诊断 zip：最近日志文件（各 type 取最新若干，受总字节预算约束）+ 内存 ring
// buffer 序列化的 NDJSON + 系统信息。落到 temp 目录，由调用方决定如何呈现给用户。
// 用异步 deflate + 异步写盘（writeZipPromise），避免同步压缩 ~20MB 阻塞主进程事件循环。
export async function buildDiagnosticsBundle(): Promise<DiagnosticsBundleResult> {
	const zip = new AdmZip();
	addRecentLogs(zip);
	addRingBuffer(zip);
	addSystemInfo(zip);

	const zipPath = join(app.getPath("temp"), `vetta-diagnostics-${nowStamp()}.zip`);
	await zip.writeZipPromise(zipPath);
	return { zipPath, sizeBytes: (await stat(zipPath)).size };
}

function addRecentLogs(zip: AdmZip): void {
	const baseDir = getAppLogBaseDir();
	let budget = MAX_LOG_BYTES;
	for (const type of APP_LOG_TYPE_LIST) {
		const dir = join(baseDir, type);
		if (!existsSync(dir)) continue;
		const files = recentFiles(dir, MAX_FILES_PER_TYPE);
		for (const file of files) {
			// 单个超额文件只跳过自己，继续尝试该 type 下更小/更老的文件，而非整组放弃。
			if (budget - file.size < 0) continue;
			budget -= file.size;
			zip.addLocalFile(file.path, `logs/${type}`);
		}
	}
}

function recentFiles(dir: string, limit: number): Array<{ path: string; size: number }> {
	const entries: Array<{ path: string; size: number; mtimeMs: number }> = [];
	for (const filename of readdirSync(dir)) {
		if (!filename.endsWith(".log")) continue;
		const path = join(dir, filename);
		try {
			const stat = statSync(path);
			entries.push({ path, size: stat.size, mtimeMs: stat.mtimeMs });
		} catch {
			// File vanished; skip.
		}
	}
	return entries.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, limit);
}

function addRingBuffer(zip: AdmZip): void {
	const lines = logRingBuffer
		.snapshot()
		.map((entry) => JSON.stringify(entry))
		.join("\n");
	zip.addFile("ring-buffer.ndjson", Buffer.from(lines, "utf-8"));
}

function addSystemInfo(zip: AdmZip): void {
	const info = {
		version: app.getVersion(),
		platform: process.platform,
		arch: process.arch,
		node: process.versions.node,
		electron: process.versions.electron,
		locale: app.getLocale(),
		exportedAt: new Date().toISOString(),
	};
	zip.addFile("system-info.json", Buffer.from(JSON.stringify(info, null, 2), "utf-8"));
}

function nowStamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}
