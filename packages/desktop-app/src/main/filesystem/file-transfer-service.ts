import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, lstat, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type {
	FileTransferAction,
	FileTransferConflictPolicy,
	FileTransferItemResult,
	FileTransferPlanItem,
	FileTransferResult,
} from "../../preload/fs-types.js";
import { assertFilesystemPathWithinProject } from "./filesystem-service.js";

function normalizePathForComparison(value: string): string {
	const normalized = resolve(value);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathWithin(root: string, targetPath: string): boolean {
	const rel = relative(normalizePathForComparison(root), normalizePathForComparison(targetPath));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function assertDirectory(path: string): Promise<void> {
	const targetStat = await stat(path);
	if (!targetStat.isDirectory()) throw new Error("Transfer destination is not a directory");
}

async function assertNoSymbolicLinks(path: string): Promise<void> {
	const pathStat = await lstat(path);
	if (pathStat.isSymbolicLink()) throw new Error("Symbolic links are not supported for external transfer");
	if (!pathStat.isDirectory()) return;
	const entries = await readdir(path);
	for (const entry of entries) {
		await assertNoSymbolicLinks(join(path, entry));
	}
}

async function inspectSource(sourcePath: string, destinationDirectory: string): Promise<FileTransferPlanItem> {
	const resolvedSource = resolve(sourcePath);
	const sourceStat = await lstat(resolvedSource);
	if (sourceStat.isSymbolicLink()) throw new Error("Symbolic links are not supported for external transfer");
	if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
		throw new Error("Only files and directories can be transferred");
	}
	if (sourceStat.isDirectory() && isPathWithin(resolvedSource, destinationDirectory)) {
		throw new Error("A directory cannot be transferred into itself");
	}
	const name = basename(resolvedSource);
	return {
		name,
		isDirectory: sourceStat.isDirectory(),
		hasConflict: existsSync(join(destinationDirectory, name)),
	};
}

export async function inspectFilesystemTransfer(
	sourcePaths: readonly string[],
	destinationDirectory: string,
): Promise<FileTransferPlanItem[]> {
	const resolvedDestination = resolve(destinationDirectory);
	assertFilesystemPathWithinProject(resolvedDestination);
	await assertDirectory(resolvedDestination);
	return Promise.all(sourcePaths.map((sourcePath) => inspectSource(sourcePath, resolvedDestination)));
}

function keepBothName(name: string, isDirectory: boolean, index: number): string {
	if (isDirectory) return `${name} (${index})`;
	const extension = extname(name);
	const stem = extension ? name.slice(0, -extension.length) : name;
	return `${stem} (${index})${extension}`;
}

function reserveKey(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

function resolveAvailableDestination(
	destinationDirectory: string,
	name: string,
	isDirectory: boolean,
	reserved: Set<string>,
): string {
	let candidate = join(destinationDirectory, name);
	let index = 1;
	while (existsSync(candidate) || reserved.has(reserveKey(candidate))) {
		candidate = join(destinationDirectory, keepBothName(name, isDirectory, index));
		index++;
	}
	reserved.add(reserveKey(candidate));
	return candidate;
}

async function copyEntry(sourcePath: string, destinationPath: string, isDirectory: boolean): Promise<void> {
	if (isDirectory) {
		await cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true, force: false });
		return;
	}
	await copyFile(sourcePath, destinationPath);
}

async function copyThroughStaging(
	sourcePath: string,
	destinationPath: string,
	isDirectory: boolean,
	replace: boolean,
): Promise<void> {
	const destinationDirectory = dirname(destinationPath);
	const transferId = randomUUID();
	const stagingPath = join(destinationDirectory, `.vetta-transfer-${transferId}`);
	const backupPath = join(destinationDirectory, `.vetta-transfer-backup-${transferId}`);
	let backedUp = false;
	try {
		await copyEntry(sourcePath, stagingPath, isDirectory);
		if (replace && existsSync(destinationPath)) {
			await rename(destinationPath, backupPath);
			backedUp = true;
		}
		await rename(stagingPath, destinationPath);
		if (backedUp) await rm(backupPath, { recursive: true, force: true });
	} catch (error) {
		await rm(stagingPath, { recursive: true, force: true });
		if (backedUp && !existsSync(destinationPath) && existsSync(backupPath)) {
			await rename(backupPath, destinationPath);
		}
		throw error;
	}
}

async function transferOne(
	sourcePath: string,
	destinationDirectory: string,
	action: FileTransferAction,
	conflictPolicy: FileTransferConflictPolicy,
	reserved: Set<string>,
): Promise<FileTransferItemResult> {
	const resolvedSource = resolve(sourcePath);
	const sourceStat = await lstat(resolvedSource);
	const isDirectory = sourceStat.isDirectory();
	const name = basename(resolvedSource);
	if (sourceStat.isSymbolicLink() || (!sourceStat.isFile() && !isDirectory)) {
		throw new Error("Only regular files and directories can be transferred");
	}
	await assertNoSymbolicLinks(resolvedSource);
	if (isDirectory && isPathWithin(resolvedSource, destinationDirectory)) {
		throw new Error("A directory cannot be transferred into itself");
	}
	if (normalizePathForComparison(dirname(resolvedSource)) === normalizePathForComparison(destinationDirectory)) {
		return { name, status: "skipped" };
	}

	const defaultDestination = join(destinationDirectory, name);
	const hasConflict = existsSync(defaultDestination) || reserved.has(reserveKey(defaultDestination));
	if (hasConflict && conflictPolicy === "skip") return { name, status: "skipped" };

	const destinationPath =
		conflictPolicy === "keep-both"
			? resolveAvailableDestination(destinationDirectory, name, isDirectory, reserved)
			: defaultDestination;
	reserved.add(reserveKey(destinationPath));

	if (action === "move" && !existsSync(destinationPath)) {
		try {
			await rename(resolvedSource, destinationPath);
			return { name, status: "moved", destinationPath };
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		}
	}

	await copyThroughStaging(resolvedSource, destinationPath, isDirectory, conflictPolicy === "replace");
	if (action === "move") {
		await rm(resolvedSource, { recursive: true, force: true });
		return { name, status: "moved", destinationPath };
	}
	return { name, status: "copied", destinationPath };
}

export async function transferFilesystemEntries(input: {
	sourcePaths: readonly string[];
	destinationDirectory: string;
	action: FileTransferAction;
	conflictPolicy: FileTransferConflictPolicy;
}): Promise<FileTransferResult> {
	const destinationDirectory = resolve(input.destinationDirectory);
	assertFilesystemPathWithinProject(destinationDirectory);
	await assertDirectory(destinationDirectory);
	const reserved = new Set<string>();
	const items: FileTransferItemResult[] = [];
	for (const sourcePath of input.sourcePaths) {
		const name = basename(sourcePath);
		try {
			items.push(await transferOne(sourcePath, destinationDirectory, input.action, input.conflictPolicy, reserved));
		} catch (error: unknown) {
			items.push({
				name,
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { items };
}
