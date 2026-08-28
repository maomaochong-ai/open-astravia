import { resolve, sep } from "node:path";

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
	const readOnlyDirectories = options.readOnlyDirectories.map(resolveDirectoryBoundary);
	const managedDirectory = resolveDirectoryBoundary(options.managedDirectory);
	return {
		isReadOnlyPath: (absolutePath) => readOnlyDirectories.some((directory) => isPathInside(absolutePath, directory)),
		isManagedPath: (absolutePath) => isPathInside(absolutePath, managedDirectory),
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
