import type { PluginFsApi } from "@vetta-org/plugin-sdk";

/**
 * Find working-form .vetd files under a scope. Packaged shares are also .vetd —
 * we sniff the first byte on open instead of guessing here; anything inside a
 * sidecar dir is skipped.
 */
export async function findVetdFiles(fs: PluginFsApi, cwd: string): Promise<string[]> {
	try {
		const all = await fs.listFilesRecursive(cwd);
		return all
			.filter((file) => file.name.endsWith(".vetd") && !file.relPath.includes(".vetd.d/"))
			.map((file) => file.path)
			.sort();
	} catch {
		return [];
	}
}

/** Working form starts with `{` (JSON manifest); packaged form is a zip (`PK`). */
export function sniffVetdKind(head: string): "working" | "packaged" | "unknown" {
	const trimmed = head.trimStart();
	if (trimmed.startsWith("{")) return "working";
	if (head.startsWith("PK")) return "packaged";
	return "unknown";
}
