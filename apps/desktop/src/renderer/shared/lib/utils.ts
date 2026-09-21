import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { createLocalFileUrl } from "@/shared/file-protocol";

/**
 * 远程项目的路径是 `ssh://<hostId>/<远端绝对路径>`。开头的 `ssh://<hostId>` 是归属，不是
 * 路径的一部分：按 `/` 切开再拼回去会把 `//` 折叠成 `/`，主进程随即认不出它是远程路径。
 * 下面的函数因此都先把这一段摘出来，只对后面的远端路径做运算。
 */
function splitRemoteOrigin(path: string): { origin: string; remotePath: string } | undefined {
	if (!isSshProjectUri(path)) return undefined;
	const hostEnd = path.indexOf("/", "ssh://".length);
	if (hostEnd < 0) return { origin: path, remotePath: "/" };
	return { origin: path.slice(0, hostEnd), remotePath: path.slice(hostEnd) };
}

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** Extract display name from a project path, handling both / and \ separators */
export function pathBasename(path: string): string {
	const remote = splitRemoteOrigin(path);
	// 远端根目录没有名字；退回主机标识总比把它当成一个叫 `ssh:` 的目录好。
	if (remote) return remote.remotePath.split("/").filter(Boolean).pop() ?? remote.origin.slice("ssh://".length);
	return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

/** Extract parent directory from a path, handling both / and \ separators. */
export function pathDirname(path: string): string {
	const remote = splitRemoteOrigin(path);
	if (remote) return `${remote.origin}${pathDirname(remote.remotePath)}`;
	const slash = path.lastIndexOf("/");
	const backslash = path.lastIndexOf("\\");
	const idx = Math.max(slash, backslash);
	if (idx < 0) return "";
	if (idx === 0) return path[0];
	// Preserve Windows drive root (e.g. C:\)
	if (idx === 2 && /^[A-Za-z]:[\\/]/.test(path)) return path.slice(0, 3);
	return path.slice(0, idx);
}

/** Join directory and file/folder name, preserving the directory's separator style when possible. */
export function pathJoin(dir: string, name: string): string {
	if (!dir) return name;
	const sep = dir.includes("\\") ? "\\" : "/";
	const trimmed = dir.replace(/[\\/]+$/, "");
	if (!trimmed) {
		return `${sep}${name}`;
	}
	return `${trimmed}${sep}${name}`;
}

/** Return true when path is equal to parent or is located under parent. */
export function isSubPath(path: string, parent: string): boolean {
	const normalize = (v: string): string => v.replace(/\\/g, "/").replace(/\/+$/, "");
	const p = normalize(path);
	const base = normalize(parent);
	if (!base) return false;
	return p === base || p.startsWith(`${base}/`);
}

/**
 * Collapse "./" and "../" segments and unify separators to "/".
 * Preserves leading "/" for POSIX absolute paths and Windows drive letters.
 * Does not touch the filesystem (no symlink resolution).
 */
export function pathNormalize(path: string): string {
	if (!path) return path;
	const remote = splitRemoteOrigin(path);
	if (remote) return `${remote.origin}${pathNormalize(remote.remotePath)}`;
	const unified = path.replace(/\\/g, "/");
	const isAbsolutePosix = unified.startsWith("/");
	const driveMatch = unified.match(/^([A-Za-z]:)\//);
	const drive = driveMatch ? driveMatch[1] : "";
	const body = drive ? unified.slice(drive.length + 1) : isAbsolutePosix ? unified.slice(1) : unified;
	const segs: string[] = [];
	for (const seg of body.split("/")) {
		if (!seg || seg === ".") continue;
		if (seg === "..") {
			if (segs.length > 0 && segs[segs.length - 1] !== "..") segs.pop();
			else if (!isAbsolutePosix && !drive) segs.push("..");
			continue;
		}
		segs.push(seg);
	}
	const joined = segs.join("/");
	if (drive) return `${drive}/${joined}`;
	if (isAbsolutePosix) return `/${joined}`;
	return joined || ".";
}

/**
 * Map a local absolute path to the privileged vetta-file:// scheme (ADR-0027).
 * Do not use file:// — Electron renderer blocks it ("Not allowed to load local resource").
 */
export function toVettaFileUrl(path: string): string {
	return createLocalFileUrl(pathNormalize(path));
}
