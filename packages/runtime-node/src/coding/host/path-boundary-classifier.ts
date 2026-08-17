import { resolve, sep } from "node:path";

export interface NodePathBoundaryClassifierOptions {
	readonly protectedDirectories: readonly string[];
	readonly knowledgeWikiDirectory: string;
}

export interface NodePathBoundaryClassifier {
	readonly isProtectedSkillOrScenePath: (absolutePath: string) => boolean;
	readonly isKnowledgeWikiPath: (absolutePath: string) => boolean;
}

/** Classifies absolute paths with the current platform's normalization and separator rules. */
export function createNodePathBoundaryClassifier(
	options: NodePathBoundaryClassifierOptions,
): NodePathBoundaryClassifier {
	const protectedDirectories = options.protectedDirectories.map(resolveDirectoryBoundary);
	const knowledgeWikiDirectory = resolveDirectoryBoundary(options.knowledgeWikiDirectory);
	return {
		isProtectedSkillOrScenePath: (absolutePath) =>
			protectedDirectories.some((directory) => isPathInside(absolutePath, directory)),
		isKnowledgeWikiPath: (absolutePath) => isPathInside(absolutePath, knowledgeWikiDirectory),
	};
}

interface ResolvedDirectoryBoundary {
	readonly path: string;
	readonly prefix: string;
}

function resolveDirectoryBoundary(directory: string): ResolvedDirectoryBoundary {
	const path = resolve(directory);
	return { path, prefix: path.endsWith(sep) ? path : `${path}${sep}` };
}

function isPathInside(absolutePath: string, directory: ResolvedDirectoryBoundary): boolean {
	const path = resolve(absolutePath);
	return path === directory.path || path.startsWith(directory.prefix);
}
