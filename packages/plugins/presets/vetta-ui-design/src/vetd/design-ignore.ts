/**
 * 设计包的 `.gitignore`：让设计放进用户自己的代码仓库时，改动仍然是一份可读的
 * 源码 diff，而不是掺着几千个二进制对象和截图。
 */
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { HISTORY_DIR } from "../history/history-paths";

/**
 * 必须被忽略的条目。`.history/` 是设计自己的版本历史（ADR-0069）——它随设计目录
 * 和 `.vetdz` 走，但不该随用户的 git 提交走。
 */
export const DESIGN_IGNORE_LINES = [
	`${HISTORY_DIR}/`,
	".snapshots/",
	".vetd-build/",
	"node_modules/",
	".notes.json",
] as const;

/**
 * 合出补齐缺失行后的内容；已经齐了返回 null（调用方据此跳过写入）。
 *
 * 只增不改：用户和其它工具往这个文件里写的东西一律保留，我们只在末尾补自己缺的那几行。
 */
export function mergeIgnoreLines(existing: string | null): string | null {
	const lines = (existing ?? "").split("\n");
	const present = new Set(lines.map((line) => line.trim()).filter(Boolean));
	const missing = DESIGN_IGNORE_LINES.filter((line) => !present.has(line));
	if (missing.length === 0) return null;
	if (existing === null || existing.trim() === "") return `${DESIGN_IGNORE_LINES.join("\n")}\n`;
	const base = existing.endsWith("\n") ? existing : `${existing}\n`;
	return `${base}${missing.join("\n")}\n`;
}

/** 幂等地补齐设计包的 `.gitignore`。写失败不影响任何功能，静默吞掉。 */
export async function ensureDesignIgnored(fs: PluginFsApi, dirPath: string): Promise<void> {
	const path = `${dirPath}/.gitignore`;
	try {
		let existing: string | null = null;
		if (await fs.stat(path)) existing = (await fs.readFile(path)).content;
		const merged = mergeIgnoreLines(existing);
		if (merged !== null) await fs.writeFile(path, merged);
	} catch {
		// Best-effort housekeeping.
	}
}
