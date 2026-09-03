import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import type { PluginServiceArtifactPayload, PluginServiceProviderManifest } from "@vetta-org/plugin-sdk";
import AdmZip from "adm-zip";
import { x as extractTar, t as listTar } from "tar";

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export interface PluginServiceRuntimePaths {
	rootDirectory: string;
	runtimeDirectory: string;
	dataDirectory: string;
	cacheDirectory: string;
	executable: string;
}

interface InstalledServiceRuntimeMarker {
	schemaVersion: 1;
	kind: "plugin-service";
	version: string;
	executable: string;
	artifacts: Array<{ destination: string; sha256: string }>;
}

function isContained(parent: string, target: string): boolean {
	const pathFromParent = relative(parent, target);
	return (
		pathFromParent === "" ||
		(!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
	);
}

function safeRelativePath(value: string, label: string): string {
	const slashPath = value.replace(/\\/g, "/");
	if (!slashPath || slashPath.includes("\0") || slashPath.startsWith("/") || /^[a-zA-Z]:\//.test(slashPath))
		throw new Error(`${label} must be a safe relative path`);
	const normalized = posix.normalize(slashPath).replace(/^\.\//, "").replace(/\/$/, "");
	if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../"))
		throw new Error(`${label} must stay inside the runtime directory`);
	return normalized;
}

function parseMarker(input: unknown): InstalledServiceRuntimeMarker | undefined {
	if (input == null || typeof input !== "object" || Array.isArray(input)) return undefined;
	const marker = input as Record<string, unknown>;
	if (
		marker.schemaVersion !== 1 ||
		marker.kind !== "plugin-service" ||
		typeof marker.version !== "string" ||
		typeof marker.executable !== "string" ||
		!Array.isArray(marker.artifacts)
	)
		return undefined;
	return marker as unknown as InstalledServiceRuntimeMarker;
}

function markerFor(service: PluginServiceProviderManifest, platformTag: string): InstalledServiceRuntimeMarker {
	const platform = service.runtime.platforms[platformTag];
	if (!platform) throw new Error(`Service runtime does not support platform ${platformTag}`);
	return {
		schemaVersion: 1,
		kind: "plugin-service",
		version: service.runtime.version,
		executable: safeRelativePath(platform.executable, "Service executable"),
		artifacts: platform.artifacts.map((artifact) => ({
			destination: safeRelativePath(artifact.destination, "Service artifact destination"),
			sha256: artifact.sha256,
		})),
	};
}

async function isReadyRuntime(targetDirectory: string, expected: InstalledServiceRuntimeMarker): Promise<boolean> {
	try {
		const marker = parseMarker(JSON.parse(await readFile(join(targetDirectory, ".runtime.json"), "utf8")) as unknown);
		if (!marker || JSON.stringify(marker) !== JSON.stringify(expected)) return false;
		return (await lstat(join(targetDirectory, ...expected.executable.split("/")))).isFile();
	} catch {
		return false;
	}
}

function decodeArtifact(data: string): Buffer {
	if (
		typeof data !== "string" ||
		data.length === 0 ||
		data.length > Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 4 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(data)
	)
		throw new Error("Invalid service runtime artifact payload");
	const buffer = Buffer.from(data, "base64");
	if (buffer.length > MAX_ARTIFACT_BYTES || buffer.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, ""))
		throw new Error("Invalid service runtime artifact payload");
	return buffer;
}

async function extractZip(buffer: Buffer, targetDirectory: string): Promise<void> {
	const entries = new AdmZip(buffer).getEntries();
	if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("Service runtime archive has too many entries");
	let uncompressedBytes = 0;
	const entryPaths = new Set<string>();
	for (const entry of entries) {
		uncompressedBytes += entry.header.size;
		if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES)
			throw new Error("Service runtime archive expands beyond the size limit");
		if ((entry.header.flags & 1) !== 0) throw new Error("Encrypted service runtime archives are not supported");
		if (((entry.attr >>> 16) & 0o170000) === 0o120000)
			throw new Error("Service runtime archive symlinks are not allowed");
		const entryPath = safeRelativePath(entry.entryName, "Service runtime archive entry");
		if (entryPaths.has(entryPath)) throw new Error("Duplicate service runtime archive entry");
		entryPaths.add(entryPath);
		const destination = resolve(targetDirectory, entryPath);
		if (!isContained(targetDirectory, destination))
			throw new Error(`Unsafe service archive path: ${entry.entryName}`);
		if (entry.isDirectory) await mkdir(destination, { recursive: true });
		else {
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, entry.getData(), { flag: "wx" });
		}
	}
}

async function extractTarGz(buffer: Buffer, targetDirectory: string, temporaryDirectory: string): Promise<void> {
	await mkdir(temporaryDirectory, { recursive: true });
	const archivePath = join(temporaryDirectory, "artifact.tar.gz");
	await writeFile(archivePath, buffer, { flag: "wx" });
	let entries = 0;
	let uncompressedBytes = 0;
	const entryPaths = new Set<string>();
	await new Promise<void>((resolveList, rejectList) => {
		const parser = listTar({ strict: true });
		parser.once("error", rejectList);
		parser.once("end", resolveList);
		parser.on("entry", (entry) => {
			try {
				entries += 1;
				uncompressedBytes += entry.size;
				if (entries > MAX_ARCHIVE_ENTRIES) throw new Error("Service runtime archive has too many entries");
				if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES)
					throw new Error("Service runtime archive expands beyond the size limit");
				const entryPath = safeRelativePath(entry.path, "Service runtime archive entry");
				if (entryPaths.has(entryPath)) throw new Error("Duplicate service runtime archive entry");
				entryPaths.add(entryPath);
				if (entry.type !== "File" && entry.type !== "Directory")
					throw new Error("Service runtime archive links and special files are not allowed");
			} catch (error) {
				parser.abort(error instanceof Error ? error : new Error(String(error)));
			}
		});
		parser.end(buffer);
	});
	await extractTar({
		file: archivePath,
		cwd: targetDirectory,
		gzip: true,
		strict: true,
		preservePaths: false,
		filter: (entryPath) => {
			safeRelativePath(entryPath, "Service runtime archive entry");
			return true;
		},
	});
}

async function replaceDirectory(preparedDirectory: string, targetDirectory: string): Promise<void> {
	const parent = dirname(targetDirectory);
	const backupDirectory = join(parent, `.${basename(targetDirectory)}-previous-${Date.now()}-${process.pid}`);
	const hadPrevious = existsSync(targetDirectory);
	if (hadPrevious) await rename(targetDirectory, backupDirectory);
	try {
		await rename(preparedDirectory, targetDirectory);
	} catch (error) {
		if (hadPrevious && existsSync(backupDirectory)) await rename(backupDirectory, targetDirectory);
		throw error;
	}
	if (hadPrevious) await rm(backupDirectory, { recursive: true, force: true }).catch(() => undefined);
}

export class PluginServiceRuntimeInstaller {
	constructor(
		private readonly rootDir: string,
		private readonly platformTag = `${process.platform}-${process.arch}`,
	) {}

	getPlatform(): { tag: string } {
		return { tag: this.platformTag };
	}

	async resolve(pluginId: string, service: PluginServiceProviderManifest): Promise<PluginServiceRuntimePaths> {
		const expected = markerFor(service, this.platformTag);
		const rootDirectory = join(this.rootDir, pluginId, service.id);
		const runtimeDirectory = join(rootDirectory, "runtime", "versions", service.runtime.version);
		const dataDirectory = join(rootDirectory, "data");
		const cacheDirectory = join(rootDirectory, "cache");
		await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
		await mkdir(cacheDirectory, { recursive: true });
		if (!(await isReadyRuntime(runtimeDirectory, expected)))
			throw new Error("Service runtime is not installed by the plugin");
		return {
			rootDirectory,
			runtimeDirectory,
			dataDirectory,
			cacheDirectory,
			executable: join(runtimeDirectory, ...expected.executable.split("/")),
		};
	}

	async install(
		pluginId: string,
		service: PluginServiceProviderManifest,
		payloads: PluginServiceArtifactPayload[],
	): Promise<PluginServiceRuntimePaths> {
		const platform = service.runtime.platforms[this.platformTag];
		if (!platform) throw new Error(`Service runtime does not support platform ${this.platformTag}`);
		const expected = markerFor(service, this.platformTag);
		const expectedByDestination = new Map(platform.artifacts.map((artifact) => [artifact.destination, artifact]));
		if (payloads.length !== expectedByDestination.size) throw new Error("Service runtime artifact set is incomplete");
		const supplied = new Map<string, Buffer>();
		for (const payload of payloads) {
			const destination = safeRelativePath(payload.destination, "Service artifact destination");
			const artifact = expectedByDestination.get(destination);
			if (!artifact || supplied.has(destination))
				throw new Error(`Unexpected service runtime artifact: ${destination}`);
			const buffer = decodeArtifact(payload.data);
			if (createHash("sha256").update(buffer).digest("hex") !== artifact.sha256)
				throw new Error("Service runtime artifact SHA-256 mismatch");
			supplied.set(destination, buffer);
		}

		const rootDirectory = join(this.rootDir, pluginId, service.id);
		const versionsDirectory = join(rootDirectory, "runtime", "versions");
		const runtimeDirectory = join(versionsDirectory, service.runtime.version);
		const dataDirectory = join(rootDirectory, "data");
		const cacheDirectory = join(rootDirectory, "cache");
		await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
		await mkdir(cacheDirectory, { recursive: true });
		if (!(await isReadyRuntime(runtimeDirectory, expected))) {
			await mkdir(versionsDirectory, { recursive: true });
			const stagingDirectory = await mkdtemp(join(versionsDirectory, `.${service.runtime.version}-install-`));
			const preparedDirectory = join(stagingDirectory, "payload");
			try {
				await mkdir(preparedDirectory, { recursive: true });
				for (const [index, artifact] of platform.artifacts.entries()) {
					const buffer = supplied.get(artifact.destination);
					if (!buffer) throw new Error("Service runtime artifact set is incomplete");
					const destination = join(
						preparedDirectory,
						...safeRelativePath(artifact.destination, "Artifact destination").split("/"),
					);
					if (!isContained(preparedDirectory, destination)) throw new Error("Unsafe service artifact destination");
					if (artifact.archive === "file") {
						await mkdir(dirname(destination), { recursive: true });
						await writeFile(destination, buffer, { flag: "wx" });
					} else {
						await mkdir(destination, { recursive: true });
						if (artifact.archive === "zip") await extractZip(buffer, destination);
						else await extractTarGz(buffer, destination, join(stagingDirectory, `tar-${index}`));
					}
				}
				const executablePath = join(preparedDirectory, ...expected.executable.split("/"));
				if (!(await lstat(executablePath).catch(() => undefined))?.isFile())
					throw new Error(`Service runtime executable is missing: ${expected.executable}`);
				if (process.platform !== "win32") await chmod(executablePath, 0o755);
				await writeFile(join(preparedDirectory, ".runtime.json"), JSON.stringify(expected), { mode: 0o600 });
				await replaceDirectory(preparedDirectory, runtimeDirectory);
			} finally {
				await rm(stagingDirectory, { recursive: true, force: true });
			}
		}
		return {
			rootDirectory,
			runtimeDirectory,
			dataDirectory,
			cacheDirectory,
			executable: join(runtimeDirectory, ...expected.executable.split("/")),
		};
	}
}
