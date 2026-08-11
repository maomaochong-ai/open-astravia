import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type DirectorySnapshot = ReadonlyMap<string, number>;

export function snapshotDirectories(directories: readonly string[]): DirectorySnapshot {
	const snapshot = new Map<string, number>();
	for (const directory of directories) snapshotDirectory(directory, snapshot);
	return snapshot;
}

export function detectDirectoryChanges(before: DirectorySnapshot, after: DirectorySnapshot): readonly string[] {
	const changed: string[] = [];
	for (const [path, modifiedAt] of after) {
		const previous = before.get(path);
		if (previous === undefined || modifiedAt > previous) changed.push(path);
	}
	return changed;
}

export function appendProtectedDirectoryWarning(text: string, paths: readonly string[]): string {
	if (paths.length === 0) return text;
	const fileList = paths.map((path) => `  - ${path}`).join("\n");
	return (
		`${text}\n\n⚠ WARNING: The following files inside skill/scene directories were created or modified by this command:\n` +
		`${fileList}\n` +
		"Skill/scene directories are READ-ONLY. Move these output files to the user's working directory (cwd) immediately " +
		"and delete the copies from the skill/scene directory."
	);
}

function snapshotDirectory(directory: string, snapshot: Map<string, number>): void {
	try {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				snapshotDirectory(path, snapshot);
				continue;
			}
			try {
				snapshot.set(path, statSync(path).mtimeMs);
			} catch {
				// File changed between readdir and stat.
			}
		}
	} catch {
		// Missing or unreadable directories are ignored like the legacy implementation.
	}
}
