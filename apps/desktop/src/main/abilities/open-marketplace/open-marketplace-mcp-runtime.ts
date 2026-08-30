import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import type { McpServerConfigData } from "../../../preload/api-types/mcp.js";
import { validateMcpConfig } from "../../mcp-config-validation.js";
import type { OpenMarketplaceMcpRuntime } from "./open-marketplace-mcp.js";

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const EXECUTABLE_TOKEN = `\${VETTA_MCP_EXECUTABLE}`;
const RUNTIME_DIRECTORY_TOKEN = `\${VETTA_MCP_RUNTIME_DIR}`;
const DATA_DIRECTORY_TOKEN = `\${VETTA_MCP_DATA_DIR}`;
const CACHE_DIRECTORY_TOKEN = `\${VETTA_MCP_CACHE_DIR}`;

type FetchArtifact = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenMarketplaceMcpRuntimeInstallerOptions {
	rootDir: string;
	platformTag?: string;
	fetchArtifact?: FetchArtifact;
}

export interface PrepareOpenMarketplaceMcpRuntimeInput {
	sourceId: string;
	slug: string;
	version: string;
	runtime: OpenMarketplaceMcpRuntime;
	server: McpServerConfigData;
}

interface InstalledRuntimeMarker {
	schemaVersion: 1;
	kind: "managed-binary";
	version: string;
	artifactSha256: string;
	executable: string;
}

function isContained(parent: string, target: string): boolean {
	const pathFromParent = relative(parent, target);
	return (
		pathFromParent === "" ||
		(!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
	);
}

function normalizedRelativePath(value: string, label: string): string {
	const slashPath = value.replace(/\\/g, "/");
	if (!slashPath || slashPath.includes("\0") || slashPath.startsWith("/") || /^[a-zA-Z]:\//.test(slashPath)) {
		throw new Error(`${label} must be a safe relative path`);
	}
	const normalized = posix.normalize(slashPath).replace(/^\.\//, "").replace(/\/$/, "");
	if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`${label} must stay inside the runtime directory`);
	}
	return normalized;
}

function abilityDirectoryName(sourceId: string, slug: string): string {
	const digest = createHash("sha256").update(sourceId).update("\0").update(slug).digest("hex").slice(0, 12);
	return `${slug}-${digest}`;
}

function replaceRuntimeTokens(value: string, paths: Record<string, string>): string {
	return value
		.replaceAll(EXECUTABLE_TOKEN, paths.executable)
		.replaceAll(RUNTIME_DIRECTORY_TOKEN, paths.runtimeDirectory)
		.replaceAll(DATA_DIRECTORY_TOKEN, paths.dataDirectory)
		.replaceAll(CACHE_DIRECTORY_TOKEN, paths.cacheDirectory);
}

function resolveServer(server: McpServerConfigData, paths: Record<string, string>): McpServerConfigData {
	if (server.type === "http") throw new Error("Managed MCP runtimes require a stdio server");
	if (server.command !== EXECUTABLE_TOKEN) {
		throw new Error(`Managed MCP runtime command must be exactly ${EXECUTABLE_TOKEN}`);
	}
	return validateMcpConfig({
		mcpServers: {
			managed: {
				...server,
				command: paths.executable,
				...(server.args ? { args: server.args.map((value) => replaceRuntimeTokens(value, paths)) } : {}),
				...(server.env
					? {
							env: Object.fromEntries(
								Object.entries(server.env).map(([key, value]) => [key, replaceRuntimeTokens(value, paths)]),
							),
						}
					: {}),
				...(server.cwd ? { cwd: replaceRuntimeTokens(server.cwd, paths) } : {}),
			},
		},
	}).mcpServers.managed as McpServerConfigData;
}

function parseMarker(input: unknown): InstalledRuntimeMarker | undefined {
	if (input == null || typeof input !== "object" || Array.isArray(input)) return undefined;
	const marker = input as Record<string, unknown>;
	if (
		marker.schemaVersion !== 1 ||
		marker.kind !== "managed-binary" ||
		typeof marker.version !== "string" ||
		typeof marker.artifactSha256 !== "string" ||
		typeof marker.executable !== "string"
	) {
		return undefined;
	}
	return marker as unknown as InstalledRuntimeMarker;
}

async function isReadyRuntime(
	targetDirectory: string,
	version: string,
	artifactSha256: string,
	executable: string,
): Promise<boolean> {
	try {
		const marker = parseMarker(JSON.parse(await readFile(join(targetDirectory, ".runtime.json"), "utf8")) as unknown);
		if (
			!marker ||
			marker.version !== version ||
			marker.artifactSha256 !== artifactSha256 ||
			marker.executable !== executable
		) {
			return false;
		}
		return (await lstat(join(targetDirectory, ...executable.split("/")))).isFile();
	} catch {
		return false;
	}
}

async function downloadArtifact(url: string, fetchArtifact: FetchArtifact): Promise<Buffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
	try {
		const response = await fetchArtifact(url, {
			headers: { Accept: "application/octet-stream", "User-Agent": "Vetta-Desktop" },
			redirect: "follow",
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`MCP runtime download failed: ${response.status}`);
		const declaredLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTIFACT_BYTES) {
			throw new Error("MCP runtime artifact is too large");
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.byteLength > MAX_ARTIFACT_BYTES) throw new Error("MCP runtime artifact is too large");
		return buffer;
	} finally {
		clearTimeout(timer);
	}
}

async function extractZip(buffer: Buffer, targetDirectory: string): Promise<void> {
	const archive = new AdmZip(buffer);
	const entries = archive.getEntries();
	if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("MCP runtime archive has too many entries");
	let uncompressedBytes = 0;
	for (const entry of entries) {
		uncompressedBytes += entry.header.size;
		if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
			throw new Error("MCP runtime archive expands beyond the size limit");
		}
		if ((entry.header.flags & 1) !== 0) throw new Error("Encrypted MCP runtime archives are not supported");
		const unixType = (entry.attr >>> 16) & 0o170000;
		if (unixType === 0o120000) throw new Error("MCP runtime archive symlinks are not allowed");
		const entryPath = normalizedRelativePath(entry.entryName, "MCP runtime archive entry");
		const destination = resolve(targetDirectory, entryPath);
		if (!isContained(targetDirectory, destination))
			throw new Error(`Unsafe MCP runtime archive path: ${entry.entryName}`);
		if (entry.isDirectory) {
			await mkdir(destination, { recursive: true });
			continue;
		}
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, entry.getData(), { flag: "wx" });
	}
}

async function replaceRuntimeDirectory(preparedDirectory: string, targetDirectory: string): Promise<void> {
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

export class OpenMarketplaceMcpRuntimeInstaller {
	private readonly rootDir: string;
	private readonly platformTag: string;
	private readonly fetchArtifact: FetchArtifact;

	constructor(options: OpenMarketplaceMcpRuntimeInstallerOptions) {
		this.rootDir = options.rootDir;
		this.platformTag = options.platformTag ?? `${process.platform}-${process.arch}`;
		this.fetchArtifact = options.fetchArtifact ?? fetch;
	}

	async prepare(input: PrepareOpenMarketplaceMcpRuntimeInput): Promise<McpServerConfigData> {
		const platform = input.runtime.platforms[this.platformTag];
		if (!platform) throw new Error(`MCP runtime does not support platform ${this.platformTag}`);
		const executable = normalizedRelativePath(platform.executable, "MCP runtime executable");
		const abilityDirectory = join(this.rootDir, abilityDirectoryName(input.sourceId, input.slug));
		const versionsDirectory = join(abilityDirectory, "runtime", "versions");
		const targetDirectory = join(versionsDirectory, input.version);
		const dataDirectory = join(abilityDirectory, "data");
		const cacheDirectory = join(abilityDirectory, "cache");
		await mkdir(dataDirectory, { recursive: true });
		await mkdir(cacheDirectory, { recursive: true });

		if (!(await isReadyRuntime(targetDirectory, input.version, platform.sha256, executable))) {
			await mkdir(versionsDirectory, { recursive: true });
			const stagingDirectory = await mkdtemp(join(versionsDirectory, `.${input.version}-install-`));
			const preparedDirectory = join(stagingDirectory, "payload");
			try {
				await mkdir(preparedDirectory, { recursive: true });
				const buffer = await downloadArtifact(platform.url, this.fetchArtifact);
				const actualSha256 = createHash("sha256").update(buffer).digest("hex");
				if (actualSha256 !== platform.sha256) throw new Error("MCP runtime artifact SHA-256 mismatch");
				if (platform.archive === "zip") {
					await extractZip(buffer, preparedDirectory);
				} else {
					const executablePath = join(preparedDirectory, ...executable.split("/"));
					await mkdir(dirname(executablePath), { recursive: true });
					await writeFile(executablePath, buffer, { flag: "wx" });
				}
				const executablePath = join(preparedDirectory, ...executable.split("/"));
				const executableInfo = await lstat(executablePath).catch(() => undefined);
				if (!executableInfo?.isFile()) throw new Error(`MCP runtime executable is missing: ${executable}`);
				if (process.platform !== "win32") await chmod(executablePath, 0o755);
				await writeFile(
					join(preparedDirectory, ".runtime.json"),
					JSON.stringify({
						schemaVersion: 1,
						kind: "managed-binary",
						version: input.version,
						artifactSha256: platform.sha256,
						executable,
					} satisfies InstalledRuntimeMarker),
					"utf8",
				);
				await replaceRuntimeDirectory(preparedDirectory, targetDirectory);
			} finally {
				await rm(stagingDirectory, { recursive: true, force: true });
			}
		}

		const executablePath = join(targetDirectory, ...executable.split("/"));
		return resolveServer(input.server, {
			executable: executablePath,
			runtimeDirectory: targetDirectory,
			dataDirectory,
			cacheDirectory,
		});
	}

	async remove(sourceId: string, slug: string): Promise<void> {
		const abilityDirectory = join(this.rootDir, abilityDirectoryName(sourceId, slug));
		await rm(join(abilityDirectory, "runtime"), { recursive: true, force: true });
	}
}
