import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import type { CodingToolExecutable, CodingToolExecutableResolver } from "@vetta/runtime-tools/coding";
import chalk from "chalk";
import { getBinDir } from "../../../config.js";
import { defaultCodingToolArchiveOperations, installCodingToolArchive } from "./archive-installer.js";
import { createCodingToolDownloadPlan, getCodingToolReleaseConfig } from "./catalog.js";
import { downloadCodingToolArchiveWithRetry, fetchLatestCodingToolVersion } from "./network.js";

const TOOLS_DIRECTORY = getBinDir();
const TERMUX_PACKAGES: Record<CodingToolExecutable, string> = { fd: "fd", rg: "ripgrep" };

export type ResolveCodingToolExecutable = (tool: CodingToolExecutable, silent?: boolean) => Promise<string | undefined>;

export interface ManagedCodingToolExecutableDependencies {
	readonly getPath: (tool: CodingToolExecutable) => string | null;
	readonly isOffline: () => boolean;
	readonly platform: () => string;
	readonly download: (tool: CodingToolExecutable) => Promise<string>;
}

export function createManagedCodingToolExecutableResolver(
	resolveExecutable: ResolveCodingToolExecutable = ensureManagedCodingToolExecutable,
): CodingToolExecutableResolver {
	return { resolve: (tool) => resolveExecutable(tool, true) };
}

export async function resolveManagedCodingToolExecutable(
	tool: CodingToolExecutable,
	silent: boolean,
	dependencies: ManagedCodingToolExecutableDependencies,
): Promise<string | undefined> {
	const existingPath = dependencies.getPath(tool);
	if (existingPath) return existingPath;

	const config = getCodingToolReleaseConfig(tool);
	if (dependencies.isOffline()) {
		if (!silent) console.log(chalk.yellow(`${config.name} not found. Offline mode enabled, skipping download.`));
		return undefined;
	}
	if (dependencies.platform() === "android") {
		if (!silent) {
			console.log(chalk.yellow(`${config.name} not found. Install with: pkg install ${TERMUX_PACKAGES[tool]}`));
		}
		return undefined;
	}

	if (!silent) console.log(chalk.dim(`${config.name} not found. Downloading...`));
	try {
		const path = await dependencies.download(tool);
		if (!silent) console.log(chalk.dim(`${config.name} installed to ${path}`));
		return path;
	} catch (error) {
		if (!silent) {
			console.log(
				chalk.yellow(`Failed to download ${config.name}: ${error instanceof Error ? error.message : error}`),
			);
		}
		return undefined;
	}
}

export async function ensureManagedCodingToolExecutable(
	tool: CodingToolExecutable,
	silent = false,
): Promise<string | undefined> {
	return resolveManagedCodingToolExecutable(tool, silent, defaultManagedExecutableDependencies);
}

const defaultManagedExecutableDependencies: ManagedCodingToolExecutableDependencies = {
	getPath: getManagedCodingToolPath,
	isOffline: isOfflineModeEnabled,
	platform,
	download: downloadManagedCodingTool,
};

function getManagedCodingToolPath(tool: CodingToolExecutable): string | null {
	const config = getCodingToolReleaseConfig(tool);
	const localPath = join(TOOLS_DIRECTORY, `${config.binaryName}${platform() === "win32" ? ".exe" : ""}`);
	if (existsSync(localPath)) return localPath;
	return commandExists(config.binaryName) ? config.binaryName : null;
}

function commandExists(command: string): boolean {
	try {
		const result = spawnSync(command, ["--version"], { stdio: "pipe" });
		return result.error === undefined || result.error === null;
	} catch {
		return false;
	}
}

function isOfflineModeEnabled(): boolean {
	const value = process.env.PI_OFFLINE;
	return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

async function downloadManagedCodingTool(tool: CodingToolExecutable): Promise<string> {
	const config = getCodingToolReleaseConfig(tool);
	const currentPlatform = platform();
	const version = await fetchLatestCodingToolVersion(config.repository);
	const plan = createCodingToolDownloadPlan({
		tool,
		version,
		platform: currentPlatform,
		architecture: arch(),
		toolsDirectory: TOOLS_DIRECTORY,
	});
	if (!plan) throw new Error(`Unsupported platform: ${currentPlatform}/${arch()}`);

	mkdirSync(TOOLS_DIRECTORY, { recursive: true });
	await downloadCodingToolArchiveWithRetry(plan.downloadUrl, plan.archivePath);
	const extractDirectory = join(
		TOOLS_DIRECTORY,
		`extract_tmp_${config.binaryName}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
	);
	mkdirSync(extractDirectory, { recursive: true });
	return installCodingToolArchive({
		plan,
		extractDirectory,
		platform: currentPlatform,
		operations: defaultCodingToolArchiveOperations,
	});
}
