import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** Extract display name from a project path, handling both / and \ separators */
export function pathBasename(path: string): string {
	return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

/** Extract parent directory from a path, handling both / and \ separators. */
export function pathDirname(path: string): string {
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
	const normalized = pathNormalize(path);
	const prefix = normalized.startsWith("/") ? "" : "/";
	return `vetta-file://local${prefix}${encodeURI(normalized)}`;
}
