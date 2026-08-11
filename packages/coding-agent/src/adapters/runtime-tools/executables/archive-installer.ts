import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import extractZip from "extract-zip";
import type { CodingToolDownloadPlan } from "./catalog.js";

export interface CodingToolArchiveOperations {
	readonly extractTarGz: (archivePath: string, extractDirectory: string, assetName: string) => void;
	readonly extractZip: (archivePath: string, extractDirectory: string) => Promise<void>;
	readonly fileExists: (path: string) => boolean;
	readonly findBinary: (rootDirectory: string, binaryFileName: string) => string | null;
	readonly moveFile: (sourcePath: string, destinationPath: string) => void;
	readonly makeExecutable: (path: string) => void;
	readonly removeFile: (path: string) => void;
	readonly removeDirectory: (path: string) => void;
}

export interface InstallCodingToolArchiveOptions {
	readonly plan: CodingToolDownloadPlan;
	readonly extractDirectory: string;
	readonly platform: NodeJS.Platform;
	readonly operations: CodingToolArchiveOperations;
}

export async function installCodingToolArchive(options: InstallCodingToolArchiveOptions): Promise<string> {
	const { plan, extractDirectory, operations } = options;
	try {
		if (plan.assetName.endsWith(".tar.gz")) {
			operations.extractTarGz(plan.archivePath, extractDirectory, plan.assetName);
		} else if (plan.assetName.endsWith(".zip")) {
			await operations.extractZip(plan.archivePath, extractDirectory);
		} else {
			throw new Error(`Unsupported archive format: ${plan.assetName}`);
		}

		const extractedDirectory = join(extractDirectory, plan.assetName.replace(/\.(tar\.gz|zip)$/, ""));
		const candidates = [join(extractedDirectory, plan.binaryFileName), join(extractDirectory, plan.binaryFileName)];
		const extractedBinary =
			candidates.find((candidate) => operations.fileExists(candidate)) ??
			operations.findBinary(extractDirectory, plan.binaryFileName) ??
			undefined;
		if (!extractedBinary) {
			throw new Error(`Binary not found in archive: expected ${plan.binaryFileName} under ${extractDirectory}`);
		}

		operations.moveFile(extractedBinary, plan.binaryPath);
		if (options.platform !== "win32") operations.makeExecutable(plan.binaryPath);
	} finally {
		operations.removeFile(plan.archivePath);
		operations.removeDirectory(extractDirectory);
	}
	return plan.binaryPath;
}

export const defaultCodingToolArchiveOperations: CodingToolArchiveOperations = {
	extractTarGz: (archivePath, extractDirectory, assetName) => {
		const result = spawnSync("tar", ["xzf", archivePath, "-C", extractDirectory], { stdio: "pipe" });
		if (result.error || result.status !== 0) {
			const message = result.error?.message ?? result.stderr?.toString().trim() ?? "unknown error";
			throw new Error(`Failed to extract ${assetName}: ${message}`);
		}
	},
	extractZip: (archivePath, extractDirectory) => extractZip(archivePath, { dir: extractDirectory }),
	fileExists: existsSync,
	findBinary: findBinaryRecursively,
	moveFile: renameSync,
	makeExecutable: (path) => chmodSync(path, 0o755),
	removeFile: (path) => rmSync(path, { force: true }),
	removeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
};

function findBinaryRecursively(rootDirectory: string, binaryFileName: string): string | null {
	const pending = [rootDirectory];
	while (pending.length > 0) {
		const currentDirectory = pending.pop();
		if (!currentDirectory) continue;
		for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
			const path = join(currentDirectory, entry.name);
			if (entry.isFile() && entry.name === binaryFileName) return path;
			if (entry.isDirectory()) pending.push(path);
		}
	}
	return null;
}
