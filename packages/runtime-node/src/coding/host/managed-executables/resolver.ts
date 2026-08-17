import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import type { CodingToolExecutable, CodingToolExecutableResolver } from "@vetta/runtime-tools";
import { defaultCodingToolArchiveOperations, installCodingToolArchive } from "./archive-installer.js";
import { createCodingToolDownloadPlan, getCodingToolReleaseConfig } from "./catalog.js";
import { downloadCodingToolArchiveWithRetry, fetchLatestCodingToolVersion } from "./network.js";

const TERMUX_PACKAGES: Record<CodingToolExecutable, string> = { fd: "fd", rg: "ripgrep" };

export type ResolveCodingToolExecutable = (tool: CodingToolExecutable, silent?: boolean) => Promise<string | undefined>;

export interface ManagedCodingToolExecutableDependencies {
	readonly getPath: (tool: CodingToolExecutable) => string | null;
	readonly isOffline: () => boolean;
	readonly platform: () => string;
	readonly download: (tool: CodingToolExecutable) => Promise<string>;
}

export interface ManagedCodingToolExecutableResolverOptions {
	readonly toolsDirectory: string;
	readonly resolveExecutable?: ResolveCodingToolExecutable;
	readonly report?: (message: string) => void;
}

export function createManagedCodingToolExecutableResolver(
	options: ManagedCodingToolExecutableResolverOptions,
): CodingToolExecutableResolver {
	const resolveExecutable =
		options.resolveExecutable ?? ((tool, silent) => ensureManagedCodingToolExecutable(tool, { ...options, silent }));
	return { resolve: (tool) => resolveExecutable(tool, true) };
}

export async function resolveManagedCodingToolExecutable(
	tool: CodingToolExecutable,
	silent: boolean,
	dependencies: ManagedCodingToolExecutableDependencies,
	report: (message: string) => void = console.log,
): Promise<string | undefined> {
	const existingPath = dependencies.getPath(tool);
	if (existingPath) return existingPath;
	const config = getCodingToolReleaseConfig(tool);
	if (dependencies.isOffline()) {
		if (!silent) report(`${config.name} not found. Offline mode enabled, skipping download.`);
		return undefined;
	}
	if (dependencies.platform() === "android") {
		if (!silent) report(`${config.name} not found. Install with: pkg install ${TERMUX_PACKAGES[tool]}`);
		return undefined;
	}
	if (!silent) report(`${config.name} not found. Downloading...`);
	try {
		const path = await dependencies.download(tool);
		if (!silent) report(`${config.name} installed to ${path}`);
		return path;
	} catch (error) {
		if (!silent) report(`Failed to download ${config.name}: ${error instanceof Error ? error.message : error}`);
		return undefined;
	}
}

export interface EnsureManagedCodingToolExecutableOptions {
	readonly toolsDirectory: string;
	readonly silent?: boolean;
	readonly report?: (message: string) => void;
}

export function ensureManagedCodingToolExecutable(
	tool: CodingToolExecutable,
	options: EnsureManagedCodingToolExecutableOptions,
): Promise<string | undefined> {
	const dependencies = createDefaultManagedExecutableDependencies(options.toolsDirectory);
	return resolveManagedCodingToolExecutable(tool, options.silent ?? false, dependencies, options.report);
}

function createDefaultManagedExecutableDependencies(toolsDirectory: string): ManagedCodingToolExecutableDependencies {
	return {
		getPath: (tool) => getManagedCodingToolPath(tool, toolsDirectory),
		isOffline: isOfflineModeEnabled,
		platform,
		download: (tool) => downloadManagedCodingTool(tool, toolsDirectory),
	};
}

function getManagedCodingToolPath(tool: CodingToolExecutable, toolsDirectory: string): string | null {
	const config = getCodingToolReleaseConfig(tool);
	const localPath = join(toolsDirectory, `${config.binaryName}${platform() === "win32" ? ".exe" : ""}`);
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

async function downloadManagedCodingTool(tool: CodingToolExecutable, toolsDirectory: string): Promise<string> {
	const config = getCodingToolReleaseConfig(tool);
	const currentPlatform = platform();
	const currentArchitecture = arch();
	const version = await fetchLatestCodingToolVersion(config.repository);
	const plan = createCodingToolDownloadPlan({
		tool,
		version,
		platform: currentPlatform,
		architecture: currentArchitecture,
		toolsDirectory,
	});
	if (!plan) throw new Error(`Unsupported platform: ${currentPlatform}/${currentArchitecture}`);

	mkdirSync(toolsDirectory, { recursive: true });
	await downloadCodingToolArchiveWithRetry(plan.downloadUrl, plan.archivePath);
	const extractDirectory = join(
		toolsDirectory,
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
