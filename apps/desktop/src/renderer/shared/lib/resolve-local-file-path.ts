import { pathJoin, pathNormalize } from "@shared/lib/utils";

function isAbsoluteLocalPath(path: string): boolean {
	const normalized = pathNormalize(path);
	return normalized.startsWith("/") || /^[A-Za-z]:(\/|$)/.test(normalized) || normalized.startsWith("//");
}

/** Resolve a renderer-visible local path against a conversation workspace. */
export function resolveLocalFilePath(path: string, cwd: string | null): string {
	let resolved = pathNormalize(path);
	if (/^\/[A-Za-z]:(\/|$)/.test(resolved)) resolved = resolved.slice(1);
	if (!isAbsoluteLocalPath(resolved) && cwd) resolved = pathNormalize(pathJoin(cwd, resolved));
	return resolved;
}
