import { pathJoin, pathNormalize } from "@shared/lib/utils";

function isAbsoluteLocalPath(path: string): boolean {
	const p = pathNormalize(path);
	return p.startsWith("/") || /^[A-Za-z]:(\/|$)/.test(p) || p.startsWith("//");
}

/**
 * Normalize markdown file hrefs (posix/windows/`file://` leftovers/relative)
 * against the session cwd so activity-panel containment checks work on Windows.
 */
export function resolveChatFilePath(path: string, cwd: string | null): string {
	let resolved = pathNormalize(path);
	// Leftover form when a naive strip turned file:///C:/… into /C:/…
	if (/^\/[A-Za-z]:(\/|$)/.test(resolved)) {
		resolved = resolved.slice(1);
	}
	if (!isAbsoluteLocalPath(resolved) && cwd) {
		resolved = pathNormalize(pathJoin(cwd, resolved));
	}
	return resolved;
}
