import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";

export interface NodeWorkspacePathAccess {
	readonly allowed: boolean;
	readonly workspaceRoot: string;
	readonly targetPath: string;
	readonly targetBoundary: string;
}

function expandHome(inputPath: string): string {
	if (inputPath === "~") return homedir();
	if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
		return resolvePath(homedir(), inputPath.slice(2));
	}
	return inputPath;
}

function normalizeForComparison(value: string): string {
	const resolved = resolvePath(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
	const normalizedTarget = normalizeForComparison(targetPath);
	const normalizedRoot = normalizeForComparison(rootPath);
	const rel = relative(normalizedRoot, normalizedTarget);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await stat(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function resolveBoundaryPath(targetPath: string): Promise<string> {
	const absolutePath = resolvePath(targetPath);
	if (await pathExists(absolutePath)) return realpath(absolutePath);

	let current = dirname(absolutePath);
	while (true) {
		if (await pathExists(current)) return realpath(current);
		const parent = dirname(current);
		if (parent === current) return absolutePath;
		current = parent;
	}
}

function toAbsolutePath(inputPath: string, cwd: string): string {
	const expanded = expandHome(inputPath);
	return isAbsolute(expanded) ? resolvePath(expanded) : resolvePath(cwd, expanded);
}

export async function resolveNodeWorkspacePathAccess(
	requestedPath: string,
	workspaceCwd: string,
): Promise<NodeWorkspacePathAccess> {
	const workspaceRoot = await resolveBoundaryPath(workspaceCwd);
	const targetPath = toAbsolutePath(requestedPath, workspaceCwd);
	const targetBoundary = await resolveBoundaryPath(targetPath);
	return {
		allowed: isWithinRoot(targetBoundary, workspaceRoot),
		workspaceRoot,
		targetPath,
		targetBoundary,
	};
}
