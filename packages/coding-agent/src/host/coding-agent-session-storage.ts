import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.js";

/**
 * 某个工作目录对应的会话分片目录（`<agentDir>/sessions/--<编码后的 cwd>--`）。
 *
 * 纯路径计算，**不建目录**——供只需要知道落点的调用方（会话目录发现、清理、诊断）
 * 使用，避免枚举全部项目时顺手在磁盘上撒一堆空目录。未传 `agentDir` 时使用全局目录。
 */
export function codingAgentSessionShardPath(cwd: string, agentDir: string = getAgentDir()): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(agentDir, "sessions", safePath);
}

/** Resolve the host-owned conversation directory shared by historical and native sessions. */
export function resolveCodingAgentSessionDir(cwd: string, sessionDir?: string, agentDir?: string): string {
	if (sessionDir) return sessionDir;
	const resolved = codingAgentSessionShardPath(cwd, agentDir);
	if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true });
	return resolved;
}
