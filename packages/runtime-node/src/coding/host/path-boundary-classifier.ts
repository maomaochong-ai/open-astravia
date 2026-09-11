import { existsSync } from "node:fs";
import { isPathInsideRoot, resolveProtectedEntry, resolveProtectedRoot } from "../shared/protected-entry-path.js";

export interface NodePathBoundaryClassifierOptions {
	readonly readOnlyDirectories: readonly string[];
	readonly managedDirectory: string;
}

export interface NodePathBoundaryClassifier {
	readonly isReadOnlyPath: (absolutePath: string) => boolean;
	readonly isManagedPath: (absolutePath: string) => boolean;
}

/** Classifies absolute paths with the current platform's normalization and separator rules. */
export function createNodePathBoundaryClassifier(
	options: NodePathBoundaryClassifierOptions,
): NodePathBoundaryClassifier {
	const readOnlyDirectories = options.readOnlyDirectories.map(resolveProtectedRoot);
	const managedDirectory = resolveProtectedRoot(options.managedDirectory);
	// Entries this session authored from scratch. Creating a new `<root>/<skill-name>` subtree is the
	// sanctioned way to add a skill or scene, so it stays writable for the follow-up files (references,
	// scripts, assets) and for revisions of the SKILL.md that was just written.
	const authoredEntries = new Set<string>();
	return {
		isReadOnlyPath: (absolutePath) => {
			const root = readOnlyDirectories.find((candidate) => isPathInsideRoot(absolutePath, candidate));
			if (!root) return false;
			const entry = resolveProtectedEntry(absolutePath, root);
			if (!entry) return true;
			if (authoredEntries.has(entry)) return false;
			if (existsSync(entry)) return true;
			authoredEntries.add(entry);
			return false;
		},
		isManagedPath: (absolutePath) => isPathInsideRoot(absolutePath, managedDirectory),
	};
}
