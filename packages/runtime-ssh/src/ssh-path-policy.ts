import type { EditPathPolicy, WritePathPolicy } from "@vetta/runtime-node/coding";
import { normalizeRemotePath } from "@vetta/ssh-transport";

/**
 * 远端路径的写入策略。
 *
 * 不能复用本地那套：本地策略保护的是本机的技能目录、场景目录和知识库 wiki，
 * 它们的路径来自本机的家目录。拿去判断远端路径，既挡不住远端真正该保护的目录，
 * 又可能因为两台机器碰巧同名而误挡。
 *
 * 路径比较也不能用 `node:path`：本机可能是 Windows，而远端路径永远是 POSIX 的。
 * `resolve()` 会把它们拼成反斜杠形式，前缀判断随即失效。
 */
const PROTECTED_SUBDIRECTORIES = [".vetta/skills", ".agents/skills"];

export function createSshPathPolicies(remoteCwd: string): {
	editPathPolicy: EditPathPolicy;
	writePathPolicy: WritePathPolicy;
} {
	const root = normalizeRemotePath(remoteCwd);
	const protectedRoots = PROTECTED_SUBDIRECTORIES.map((suffix) => `${root}/${suffix}`);
	const getRejectionReason = (absolutePath: string): string | undefined => {
		const target = normalizeRemotePath(absolutePath);
		for (const protectedRoot of protectedRoots) {
			if (target === protectedRoot || target.startsWith(`${protectedRoot}/`)) {
				return `${protectedRoot} is managed by Vetta and is read-only.`;
			}
		}
		return undefined;
	};
	return { editPathPolicy: { getRejectionReason }, writePathPolicy: { getRejectionReason } };
}
