import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, win32 } from "node:path";
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { CancellationError } from "builder-util-runtime";
import type { ResolvedUpdateFileInfo } from "electron-updater";

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const WINDOWS_EXECUTABLE_NAME = "Vetta.exe";

interface StagedUpdateSelection {
	version: string;
	size: number;
	fileName: string;
}

interface PreparedUpdate {
	version: string;
	executablePath: string;
}

interface VersionPointer {
	version: string;
	previousVersion?: string;
	pending?: boolean;
}

export interface StagedUpdateAsset {
	assetFileName: string;
	totalBytes: number;
}

export interface StagedUpdateRuntime {
	currentVersion: string;
	storeRoot: string;
	extractorPath: string;
	extractInstaller?: (
		installerPath: string,
		destination: string,
		version: string,
		signal: AbortSignal,
	) => Promise<void>;
	relaunch(executablePath: string): void;
	quit(): void;
}

function isValidVersion(version: string): boolean {
	return version !== "." && version !== ".." && VERSION_PATTERN.test(version);
}

function parsePointer(value: unknown): VersionPointer | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.version !== "string" || !isValidVersion(record.version)) return null;
	if (
		record.previousVersion !== undefined &&
		(typeof record.previousVersion !== "string" || !isValidVersion(record.previousVersion))
	) {
		return null;
	}
	if (record.pending !== undefined && typeof record.pending !== "boolean") return null;
	return {
		version: record.version,
		previousVersion: record.previousVersion,
		pending: record.pending,
	};
}

async function readPointer(path: string): Promise<VersionPointer | null> {
	try {
		return parsePointer(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return null;
	}
}

async function writePointer(path: string, pointer: VersionPointer): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(pointer)}\n`, "utf8");
	try {
		await rename(temporaryPath, path);
	} catch (error) {
		const code = error instanceof Error && "code" in error ? error.code : undefined;
		if (code !== "EEXIST" && code !== "EPERM") throw error;
		await rm(path, { force: true });
		await rename(temporaryPath, path);
	}
}

function fileNameFromUrl(url: string): string {
	try {
		return decodeURIComponent(basename(new URL(url).pathname));
	} catch {
		return basename(url);
	}
}

function findWindowsInstaller(
	info: UpdateInfo,
	resolvedFiles: readonly ResolvedUpdateFileInfo[],
): StagedUpdateSelection | null {
	for (const file of resolvedFiles) {
		if (!file.url.pathname.toLowerCase().endsWith(".exe")) continue;
		if (typeof file.info.sha512 !== "string" || file.info.sha512.length === 0) return null;
		if (typeof file.info.size !== "number" || !Number.isSafeInteger(file.info.size) || file.info.size <= 0) {
			return null;
		}
		if (!isValidVersion(info.version)) return null;
		return {
			version: info.version,
			size: file.info.size,
			fileName: fileNameFromUrl(file.url.href),
		};
	}
	return null;
}

async function extractWith7Zip(
	extractorPath: string,
	installerPath: string,
	destination: string,
	version: string,
	signal: AbortSignal,
): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child: ChildProcess = spawn(
			extractorPath,
			["x", "-t7z", "-y", `-o${destination}`, installerPath, `versions\\${version}\\*`],
			{
				stdio: "ignore",
				windowsHide: true,
			},
		);
		const abort = () => child.kill();
		signal.addEventListener("abort", abort, { once: true });
		child.once("error", reject);
		child.once("exit", (code) => {
			signal.removeEventListener("abort", abort);
			if (signal.aborted) {
				reject(new CancellationError());
				return;
			}
			if (code === 0) resolvePromise();
			else reject(new Error(`7-Zip exited with code ${code ?? "unknown"}`));
		});
	});
}

async function assertFile(path: string): Promise<void> {
	try {
		const info = await stat(path);
		if (info.isFile()) return;
	} catch {
		// Report one stable extraction validation error below.
	}
	throw new Error(`Expected file: ${path}`);
}

async function assertCompleteVersionDirectory(versionDir: string): Promise<void> {
	await Promise.all([
		assertFile(join(versionDir, WINDOWS_EXECUTABLE_NAME)),
		assertFile(join(versionDir, "resources", "app.asar")),
	]);
}

export function isVersionedWindowsExecutable(executablePath: string, version: string): boolean {
	if (!isValidVersion(version)) return false;
	const versionDir = win32.dirname(executablePath);
	return (
		win32.basename(executablePath).toLowerCase() === WINDOWS_EXECUTABLE_NAME.toLowerCase() &&
		win32.basename(versionDir) === version &&
		win32.basename(win32.dirname(versionDir)).toLowerCase() === "versions"
	);
}

export function resolveStagedUpdateStoreRoot(localAppData = process.env.LOCALAPPDATA): string {
	if (!localAppData) throw new Error("LOCALAPPDATA is unavailable");
	return win32.resolve(localAppData, "OpenVetta", "Desktop");
}

export function resolveWindowsUpdateExtractorPath(resourcesPath: string): string {
	return win32.resolve(resourcesPath, "tools", "7zip", "7z.exe");
}

export class StagedWindowsUpdateController {
	private selection: StagedUpdateSelection | null = null;
	private prepared: PreparedUpdate | null = null;
	private readonly extractInstaller: (
		installerPath: string,
		destination: string,
		version: string,
		signal: AbortSignal,
	) => Promise<void>;

	constructor(private readonly runtime: StagedUpdateRuntime) {
		this.extractInstaller =
			runtime.extractInstaller ??
			((installerPath, destination, version, signal) =>
				extractWith7Zip(runtime.extractorPath, installerPath, destination, version, signal));
	}

	select(info: UpdateInfo, resolvedFiles: readonly ResolvedUpdateFileInfo[]): StagedUpdateAsset | null {
		this.selection = findWindowsInstaller(info, resolvedFiles);
		this.prepared = null;
		return this.selection
			? {
					assetFileName: this.selection.fileName,
					totalBytes: this.selection.size,
				}
			: null;
	}

	async stageDownloadedInstaller(
		installerPath: string,
		onProgress: (progress: ProgressInfo) => void,
		signal: AbortSignal,
	): Promise<string[]> {
		const selection = this.selection;
		if (!selection) throw new Error("No staged Windows update selected");
		const prepared = await this.stage(selection, installerPath, onProgress, signal);
		return [prepared.executablePath];
	}

	async activate(): Promise<void> {
		const prepared = this.prepared;
		if (!prepared) throw new Error("Staged Windows update is not ready");
		const pointerPath = join(this.runtime.storeRoot, "current.json");
		const pointer: VersionPointer = {
			version: prepared.version,
			previousVersion: this.runtime.currentVersion,
			pending: true,
		};
		await writePointer(pointerPath, pointer);
		this.runtime.relaunch(prepared.executablePath);
		this.runtime.quit();
	}

	async markCurrentVersionHealthy(): Promise<void> {
		const pointerPath = join(this.runtime.storeRoot, "current.json");
		const pointer = await readPointer(pointerPath);
		if (!pointer || pointer.version !== this.runtime.currentVersion || !pointer.pending) return;
		await writePointer(pointerPath, { ...pointer, pending: false });
		await this.cleanupVersions(pointer);
	}

	private async stage(
		selection: StagedUpdateSelection,
		installerPath: string,
		onProgress: (progress: ProgressInfo) => void,
		signal: AbortSignal,
	): Promise<PreparedUpdate> {
		const destinationDir = join(this.runtime.storeRoot, "versions", selection.version);
		const destinationExecutable = join(destinationDir, WINDOWS_EXECUTABLE_NAME);
		try {
			await assertCompleteVersionDirectory(destinationDir);
			const prepared = { version: selection.version, executablePath: destinationExecutable };
			this.prepared = prepared;
			onProgress({
				bytesPerSecond: 0,
				delta: 0,
				percent: 100,
				total: selection.size,
				transferred: selection.size,
			});
			return prepared;
		} catch {
			// Continue with download and staging.
		}

		try {
			await rm(destinationDir, {
				recursive: true,
				force: true,
				maxRetries: 20,
				retryDelay: 250,
			});
			await mkdir(this.runtime.storeRoot, { recursive: true });
			onProgress({
				bytesPerSecond: 0,
				delta: 0,
				percent: 95,
				total: selection.size,
				transferred: selection.size,
			});
			await this.extractInstaller(installerPath, this.runtime.storeRoot, selection.version, signal);
			if (signal.aborted) throw new CancellationError();

			await assertCompleteVersionDirectory(destinationDir);

			const prepared = { version: selection.version, executablePath: destinationExecutable };
			this.prepared = prepared;
			onProgress({
				bytesPerSecond: 0,
				delta: 0,
				percent: 100,
				total: selection.size,
				transferred: selection.size,
			});
			return prepared;
		} catch (error) {
			void rm(destinationDir, {
				recursive: true,
				force: true,
				maxRetries: 20,
				retryDelay: 250,
			}).catch((cleanupError) => {
				console.warn("[updater] unable to remove incomplete staged version", cleanupError);
			});
			throw error;
		}
	}

	private async cleanupVersions(pointer: VersionPointer): Promise<void> {
		const versionsRoot = join(this.runtime.storeRoot, "versions");
		const keep = new Set(
			[pointer.version, pointer.previousVersion].filter((version): version is string => Boolean(version)),
		);
		let entries: string[];
		try {
			entries = await readdir(versionsRoot);
		} catch {
			return;
		}
		await Promise.all(
			entries
				.filter((entry) => isValidVersion(entry) && !keep.has(entry))
				.map((entry) => rm(join(versionsRoot, entry), { recursive: true, force: true })),
		);
	}
}
