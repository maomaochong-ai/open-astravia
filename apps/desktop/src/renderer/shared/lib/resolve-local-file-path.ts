import { isSubPath, pathJoin, pathNormalize } from "@shared/lib/utils";
import { formatSshProjectUri, isSshProjectUri, parseProjectLocation } from "@vetta/ssh-transport/project-uri";

function isAbsoluteLocalPath(path: string): boolean {
	const normalized = pathNormalize(path);
	return normalized.startsWith("/") || /^[A-Za-z]:(\/|$)/.test(normalized) || normalized.startsWith("//");
}

/**
 * Resolve a renderer-visible path against a conversation workspace.
 *
 * 远程项目里，Agent 的工具跑在远端，消息里出现的是**远端上的绝对路径**（`/srv/app/src/a.ts`）。
 * 它落在项目目录之下时换回项目 URI，文件面板才会去远端打开它；否则同一个字符串会被当成
 * 本机路径，两台机器目录结构相近时打开的是本机那份无关的文件。项目目录之外的绝对路径
 * 保持原样：宿主自己给出的本机路径（粘贴的图片、技能资料）也长这样。
 */
export function resolveLocalFilePath(path: string, cwd: string | null): string {
	if (isSshProjectUri(path)) return pathNormalize(path);
	let resolved = pathNormalize(path);
	if (/^\/[A-Za-z]:(\/|$)/.test(resolved)) resolved = resolved.slice(1);
	if (cwd && isSshProjectUri(cwd)) return resolveAgainstRemoteProject(resolved, cwd);
	if (!isAbsoluteLocalPath(resolved) && cwd) resolved = pathNormalize(pathJoin(cwd, resolved));
	return resolved;
}

function resolveAgainstRemoteProject(path: string, projectUri: string): string {
	if (!path.startsWith("/")) return pathNormalize(pathJoin(projectUri, path));
	const location = parseProjectLocation(projectUri);
	if (location.kind !== "ssh" || !isSubPath(path, location.remotePath)) return path;
	return formatSshProjectUri(location.hostId, path);
}
