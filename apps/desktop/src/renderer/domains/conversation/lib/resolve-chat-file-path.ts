import { resolveLocalFilePath } from "@shared/lib/resolve-local-file-path";

/**
 * Normalize markdown file hrefs (posix/windows/`file://` leftovers/relative)
 * against the session cwd so activity-panel containment checks work on Windows.
 */
export function resolveChatFilePath(path: string, cwd: string | null): string {
	return resolveLocalFilePath(path, cwd);
}
