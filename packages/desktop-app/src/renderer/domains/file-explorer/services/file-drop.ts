function normalizePath(value: string): string {
	const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
	return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function isProjectInternalDrop(paths: readonly string[], rootDirectory: string): boolean {
	if (paths.length === 0) return false;
	const root = normalizePath(rootDirectory);
	if (!root) return false;
	return paths.every((path) => {
		const candidate = normalizePath(path);
		return candidate === root || candidate.startsWith(`${root}/`);
	});
}
