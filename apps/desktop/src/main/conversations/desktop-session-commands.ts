import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { getAppLogger } from "../logger.js";
import { emitConversationListChanged } from "./conversation-list-events.js";
import { assertOrdinaryConversationPath } from "./conversation-ownership-guard.js";
import { forgetConversations } from "./conversation-tags-store.js";
import { isConversationSubCwd, readSessionCwdFromHeader, resolveSessionListCwd } from "./session-paths.js";
import { forgetSessionPins } from "./session-pins-store.js";

const log = getAppLogger("session");

export interface DesktopSessionCommandsDependencies {
	readonly runtime: {
		deleteSession(sessionPath: string): Promise<void>;
		renameSession(sessionPath: string, name: string): Promise<void>;
	};
	/** 自动化在 scheduler 里，它反过来依赖本目录，所以由调用方接上（ADR-0127）。 */
	readonly onSessionsDeleted: (isDeleted: (sessionPath: string) => boolean) => void;
	/** 消息问答批注挂着模型运行时，同样由调用方接上。 */
	readonly forgetAnnotations: (sessionPath: string) => Promise<void>;
	readonly assertOrdinary?: (sessionPath: string) => Promise<unknown>;
	readonly readSessionCwd?: (sessionPath: string) => Promise<string | undefined>;
	readonly removeDirectory?: (dir: string) => Promise<void>;
	readonly forgetUserMarks?: (sessionPaths: readonly string[]) => void;
	readonly emitListChanged?: typeof emitConversationListChanged;
}

export interface DesktopSessionCommands {
	/** 删除会话文件及其附属：对话子目录、置顶、标签、批注、自动化绑定，并通知会话列表。 */
	delete(sessionPath: string): Promise<void>;
	rename(sessionPath: string, name: string): Promise<void>;
}

/**
 * 普通会话的删除与重命名。侧边栏（IPC）和配对的手机（远程镜像）共用这一份，
 * 手机上删改的会话才会同样清理干净、出现在侧边栏里。只接受普通会话：
 * Agent Team 名下的会话由团队自己管理。
 */
export function createDesktopSessionCommands(deps: DesktopSessionCommandsDependencies): DesktopSessionCommands {
	const assertOrdinary = deps.assertOrdinary ?? assertOrdinaryConversationPath;
	const readSessionCwd = deps.readSessionCwd ?? readSessionCwdFromHeader;
	const removeDirectory = deps.removeDirectory ?? ((dir) => rm(dir, { recursive: true, force: true }));
	const forgetUserMarks =
		deps.forgetUserMarks ??
		((paths) => {
			forgetSessionPins(paths);
			forgetConversations(paths);
		});
	const emitListChanged = deps.emitListChanged ?? emitConversationListChanged;

	const notifyList = (sessionPath: string, cwd: string | undefined): void => {
		if (cwd) emitListChanged({ cwd: resolveSessionListCwd(cwd), sessionPath });
	};

	return {
		async delete(sessionPath) {
			await assertOrdinary(sessionPath);
			// ADR-0007: 「对话」项目下的 session cwd 是独立子目录；删除 session 时
			// 连带回收子目录里的产物。读 header 先取 cwd，再 delete，最后 rm 子目录。
			const cwd = await readSessionCwd(sessionPath);
			await deps.runtime.deleteSession(sessionPath);
			await deps.forgetAnnotations(sessionPath);
			deps.onSessionsDeleted((path) => path === sessionPath);
			forgetUserMarks([sessionPath]);
			if (cwd && isConversationSubCwd(cwd)) {
				await removeDirectory(resolve(cwd)).catch((error: unknown) => {
					log.error("failed to remove conversation sub cwd", cwd, error);
				});
			}
			notifyList(sessionPath, cwd);
		},
		async rename(sessionPath, name) {
			await assertOrdinary(sessionPath);
			await deps.runtime.renameSession(sessionPath, name);
			notifyList(sessionPath, await readSessionCwd(sessionPath));
		},
	};
}
