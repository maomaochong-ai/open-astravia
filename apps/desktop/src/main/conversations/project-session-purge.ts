import { resolve } from "node:path";
import {
	DEFAULT_CONVERSATION_CWD,
	DEFAULT_IM_CONVERSATION_CWD,
	KB_PROCESSING_CWD,
} from "../config/desktop-config-store.js";

/**
 * 项目硬删除时清空该 cwd 的会话存储。
 *
 * 会话文件不在项目目录里，而是在按 cwd 路径算出的全局分片目录
 * （`~/.vetta/agent/sessions/--<路径>--`，见 `codingAgentSessionShardPath`）。
 * 只删项目目录不会动它，于是同路径重建项目时旧会话会原样复活。
 */
export interface ProjectSessionPurgeDependencies {
	/** 列出该 cwd 名下的全部会话（并集分片目录与 `<项目>/.vetta/sessions`）。 */
	readonly listSessions: (cwd: string) => Promise<readonly { readonly path: string }[]>;
	/** 单条会话的完整回收：dispose 活动句柄 + 删 jsonl/snapshot/lock/产物。 */
	readonly deleteSession: (sessionPath: string) => Promise<void>;
	/** 该 cwd 对应的会话目录，会话删净后连目录一起回收。 */
	readonly resolveSessionDirs: (cwd: string) => readonly string[];
	readonly removeDirectory: (dir: string) => Promise<void>;
	readonly logError: (message: string, ...args: unknown[]) => void;
}

export interface ProjectSessionPurgeResult {
	readonly deleted: number;
	/** 删除失败的会话路径；非空时保留会话目录，避免把删不掉的东西连目录强拆。 */
	readonly failed: readonly string[];
}

/** 这些 cwd 由「对话」/Claw/知识库共享，会话不属于任何一个可硬删除的项目。 */
const PROTECTED_CWDS = [DEFAULT_CONVERSATION_CWD, DEFAULT_IM_CONVERSATION_CWD, KB_PROCESSING_CWD];

export function isProtectedProjectCwd(cwd: string): boolean {
	const absolute = resolve(cwd);
	return PROTECTED_CWDS.some((protectedCwd) => resolve(protectedCwd) === absolute);
}

export async function purgeProjectSessions(
	cwd: string,
	dependencies: ProjectSessionPurgeDependencies,
): Promise<ProjectSessionPurgeResult> {
	if (isProtectedProjectCwd(cwd)) {
		throw new Error(`Refusing to purge sessions for a built-in conversation cwd: ${cwd}`);
	}

	const sessions = await dependencies.listSessions(cwd);
	const failed: string[] = [];
	let deleted = 0;
	// 串行：deleteSession 会 dispose 活动句柄并抢文件锁，并发删同一目录容易互相打架。
	for (const session of sessions) {
		try {
			await dependencies.deleteSession(session.path);
			deleted += 1;
		} catch (error) {
			failed.push(session.path);
			dependencies.logError("failed to delete session while purging project", session.path, error);
		}
	}

	if (failed.length === 0) {
		for (const dir of dependencies.resolveSessionDirs(cwd)) {
			try {
				await dependencies.removeDirectory(dir);
			} catch (error) {
				dependencies.logError("failed to remove session directory while purging project", dir, error);
			}
		}
	}

	return { deleted, failed };
}
