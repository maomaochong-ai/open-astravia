import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findProtectedEntry, type ProtectedRoot, resolveProtectedRoot } from "./protected-entry-path.js";

export type DirectorySnapshot = ReadonlyMap<string, number>;

export function snapshotDirectories(directories: readonly string[]): DirectorySnapshot {
	const snapshot = new Map<string, number>();
	for (const directory of directories) snapshotDirectory(directory, snapshot);
	return snapshot;
}

/**
 * Reports files a command created or modified inside protected directories. Entries that did not exist
 * before the command ran are newly authored skills or scenes rather than artifacts dumped into an
 * existing one, so they are not reported.
 */
export function detectDirectoryChanges(
	before: DirectorySnapshot,
	after: DirectorySnapshot,
	directories: readonly string[] = [],
): readonly string[] {
	const roots = directories.map(resolveProtectedRoot);
	const existingEntries = collectEntries(before, roots);
	const changed: string[] = [];
	for (const [path, modifiedAt] of after) {
		const previous = before.get(path);
		if (previous !== undefined && modifiedAt <= previous) continue;
		const entry = findProtectedEntry(path, roots);
		if (entry && !existingEntries.has(entry)) continue;
		changed.push(path);
	}
	return changed;
}

export function appendProtectedDirectoryWarning(text: string, paths: readonly string[]): string {
	if (paths.length === 0) return text;
	const fileList = paths.map((path) => `  - ${path}`).join("\n");
	return (
		`${text}\n\n⚠ WARNING: The following files inside protected read-only directories were created or modified by this command:\n` +
		`${fileList}\n` +
		"These directories are READ-ONLY. Move the output files to the working directory immediately " +
		"and delete the copies from the protected directory."
	);
}

function collectEntries(snapshot: DirectorySnapshot, roots: readonly ProtectedRoot[]): ReadonlySet<string> {
	const entries = new Set<string>();
	for (const path of snapshot.keys()) {
		const entry = findProtectedEntry(path, roots);
		if (entry) entries.add(entry);
	}
	return entries;
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
