import { join, relative, resolve, sep } from "node:path";

/** A resolved read-only root together with the prefix used for containment checks. */
export interface ProtectedRoot {
	readonly path: string;
	readonly prefix: string;
}

export function resolveProtectedRoot(directory: string): ProtectedRoot {
	const path = resolve(directory);
	return { path, prefix: path.endsWith(sep) ? path : `${path}${sep}` };
}

export function isPathInsideRoot(absolutePath: string, root: ProtectedRoot): boolean {
	const path = resolve(absolutePath);
	return path === root.path || path.startsWith(root.prefix);
}

/**
 * Resolves the `<root>/<skill-name>` subtree a path belongs to. Skills and scenes are authored as such a
 * subtree, so only paths nested inside one have an entry; the root itself and files sitting directly in it
 * are loose artifacts rather than a resource being authored, and get no entry.
 */
export function resolveProtectedEntry(absolutePath: string, root: ProtectedRoot): string | undefined {
	const path = resolve(absolutePath);
	if (path === root.path) return undefined;
	const [segment, ...nested] = relative(root.path, path).split(sep);
	return segment && nested.length > 0 ? join(root.path, segment) : undefined;
}

export function findProtectedEntry(absolutePath: string, roots: readonly ProtectedRoot[]): string | undefined {
	const root = roots.find((candidate) => isPathInsideRoot(absolutePath, candidate));
	return root ? resolveProtectedEntry(absolutePath, root) : undefined;
}
