import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, win32 } from "node:path";
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { CancellationError } from "builder-util-runtime";
import type { ResolvedUpdateFileInfo } from "electron-updater";

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const WINDOWS_EXECUTABLE_NAME = "Vetta.exe";
const PROGRESS_POLL_INTERVAL_MS = 250;
const INNO_COMPLETION_TIMEOUT_MS = 30_000;

interface InnoUpdateSelection {
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

export interface InnoUpdateAsset {
	assetFileName: string;
	totalBytes: number;
}

export interface InnoUpdateRuntime {
	currentVersion: string;
	storeRoot: string;
	installInstaller?: (
		installerPath: string,
		storeRoot: string,
		version: string,
		onProgress: (percent: number) => void,
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
): InnoUpdateSelection | null {
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

export function buildInnoUpdateArguments(storeRoot: string, progressPath: string, logPath: string): string[] {
	return [
		"/VERYSILENT",
		"/SUPPRESSMSGBOXES",
		"/NORESTART",
		"/NOCLOSEAPPLICATIONS",
		"/NORESTARTAPPLICATIONS",
		"/SP-",
		"/VETTAUPDATE=true",
		`/VETTASTOREROOT=${storeRoot}`,
		`/VETTAPROGRESS=${progressPath}`,
		`/LOG=${logPath}`,
	];
}

async function readInstallProgress(progressPath: string): Promise<number | null> {
	try {
		const [currentRaw, maximumRaw] = (await readFile(progressPath, "utf8")).trim().split(",");
		const current = Number(currentRaw);
		const maximum = Number(maximumRaw);
		if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return null;
		return Math.max(0, Math.min(100, (current / maximum) * 100));
	} catch {
		return null;
	}
}

async function installWithInno(
	installerPath: string,
	storeRoot: string,
	version: string,
	onProgress: (percent: number) => void,
	signal: AbortSignal,
): Promise<void> {
	const workRoot = join(storeRoot, "installer", `${version}-${process.pid}-${Date.now()}`);
	const progressPath = join(workRoot, "progress");
	const logPath = join(workRoot, "install.log");
	await mkdir(workRoot, { recursive: true });

	try {
		await new Promise<void>((resolvePromise, reject) => {
			const child = spawn(installerPath, buildInnoUpdateArguments(storeRoot, progressPath, logPath), {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});
			child.unref();
			let readingProgress = false;
			const pollProgress = () => {
				if (readingProgress) return;
				readingProgress = true;
				void readInstallProgress(progressPath)
					.then((percent) => {
						if (percent !== null) onProgress(percent);
					})
					.finally(() => {
						readingProgress = false;
					});
			};
			const progressTimer = setInterval(pollProgress, PROGRESS_POLL_INTERVAL_MS);
			child.once("error", (error) => {
				clearInterval(progressTimer);
				reject(error);
			});
			child.once("close", (code) => {
				clearInterval(progressTimer);
				if (signal.aborted) {
					reject(new CancellationError());
					return;
				}
				if (code === 0) resolvePromise();
				else reject(new Error(`Inno Setup exited with code ${code ?? "unknown"}`));
			});
		});
	} finally {
		void rm(workRoot, { recursive: true, force: true }).catch((error) => {
			console.warn("[updater] unable to remove Inno Setup working directory", error);
		});
	}
}

async function assertFile(path: string): Promise<void> {
	try {
		const info = await stat(path);
		if (info.isFile()) return;
	} catch {
		// Report one stable validation error below.
	}
	throw new Error(`Expected file: ${path}`);
}

async function assertCompleteVersionDirectory(versionDir: string): Promise<void> {
	await Promise.all([
		assertFile(join(versionDir, WINDOWS_EXECUTABLE_NAME)),
		assertFile(join(versionDir, "resources", "app.asar")),
	]);
}

async function waitForCompleteVersionDirectory(versionDir: string, signal: AbortSignal): Promise<void> {
	const deadline = Date.now() + INNO_COMPLETION_TIMEOUT_MS;
	let lastError: unknown;
	do {
		if (signal.aborted) throw new CancellationError();
		try {
			await assertCompleteVersionDirectory(versionDir);
			return;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, PROGRESS_POLL_INTERVAL_MS));
	} while (Date.now() < deadline);
	throw lastError;
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

export function resolveInnoUpdateStoreRoot(localAppData = process.env.LOCALAPPDATA): string {
	if (!localAppData) throw new Error("LOCALAPPDATA is unavailable");
	return win32.resolve(localAppData, "Vetta");
}

export class InnoWindowsUpdateController {
	private selection: InnoUpdateSelection | null = null;
	private prepared: PreparedUpdate | null = null;
	private readonly installInstaller: NonNullable<InnoUpdateRuntime["installInstaller"]>;

	constructor(private readonly runtime: InnoUpdateRuntime) {
		this.installInstaller = runtime.installInstaller ?? installWithInno;
	}

	select(info: UpdateInfo, resolvedFiles: readonly ResolvedUpdateFileInfo[]): InnoUpdateAsset | null {
		this.selection = findWindowsInstaller(info, resolvedFiles);
		this.prepared = null;
		return this.selection
			? {
					assetFileName: this.selection.fileName,
					totalBytes: this.selection.size,
				}
			: null;
	}

	async prepareDownloadedInstaller(
		installerPath: string,
		onProgress: (progress: ProgressInfo) => void,
		signal: AbortSignal,
	): Promise<string[]> {
		const selection = this.selection;
		if (!selection) throw new Error("No Inno Setup Windows update selected");
		const destinationDir = join(this.runtime.storeRoot, "versions", selection.version);
		const executablePath = join(destinationDir, WINDOWS_EXECUTABLE_NAME);
		const report = (percent: number) =>
			onProgress({
				bytesPerSecond: 0,
				delta: 0,
				percent: 91 + Math.max(0, Math.min(100, percent)) * 0.08,
				total: selection.size,
				transferred: selection.size,
			});

		try {
			await assertCompleteVersionDirectory(destinationDir);
			this.prepared = { version: selection.version, executablePath };
			report(100);
			return [executablePath];
		} catch {
			// Continue with the downloaded installer.
		}

		report(0);
		console.info("[updater] preparing Windows version with Inno Setup", installerPath);
		let installError: unknown;
		try {
			await this.installInstaller(installerPath, this.runtime.storeRoot, selection.version, report, signal);
		} catch (error) {
			installError = error;
		}
		try {
			await waitForCompleteVersionDirectory(destinationDir, signal);
		} catch (error) {
			throw installError ?? error;
		}
		this.prepared = { version: selection.version, executablePath };
		onProgress({
			bytesPerSecond: 0,
			delta: 0,
			percent: 100,
			total: selection.size,
			transferred: selection.size,
		});
		return [executablePath];
	}

	async activate(): Promise<void> {
		const prepared = this.prepared;
		if (!prepared) throw new Error("Inno Setup Windows update is not ready");
		await writePointer(join(this.runtime.storeRoot, "current.json"), {
			version: prepared.version,
			previousVersion: this.runtime.currentVersion,
			pending: true,
		});
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
