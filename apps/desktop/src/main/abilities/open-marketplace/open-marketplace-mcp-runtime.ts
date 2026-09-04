import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import type {
	OpenMarketplaceMcpRuntimeProgress,
	OpenMarketplaceMcpRuntimeProgressPhase,
} from "../../../preload/api-types/abilities.js";
import type { McpServerConfigData, McpStdioServerConfigData } from "../../../preload/api-types/mcp.js";
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

/**
 * 桥接产物与 main 打包在同一个输出目录（见 vite.main.config.ts 的 lib.entry）。
 * 路径必须相对**产物**而不是源码目录：main 全部打进 dist/main/index.js，
 * import.meta.url 在运行时就是那个文件，所以这里只能是同级的 `./`。
 */
function bridgeScriptPath(): string {
	return fileURLToPath(new URL(/* @vite-ignore */ "./mcp-http-bridge.mjs", import.meta.url));
}

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
	onProgress?: (progress: OpenMarketplaceMcpRuntimeProgress) => void;
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

/**
 * 服务型受管运行时：mcp.json 里落的是桥接命令，真正的二进制、参数与端口占位符收进 spec。
 * 桥接跑在 Electron 的 node 模式下，不额外依赖机器上的 node。
 */
function resolveBridgedServer(
	server: McpStdioServerConfigData,
	service: NonNullable<OpenMarketplaceMcpRuntime["service"]>,
	paths: Record<string, string>,
): McpServerConfigData {
	const spec = {
		schemaVersion: 1,
		command: paths.executable,
		args: (server.args ?? []).map((value) => replaceRuntimeTokens(value, paths)),
		env: Object.fromEntries(
			Object.entries(server.env ?? {}).map(([key, value]) => [key, replaceRuntimeTokens(value, paths)]),
		),
		...(server.cwd ? { cwd: replaceRuntimeTokens(server.cwd, paths) } : {}),
		path: service.path,
		...(service.readyTimeoutMs ? { readyTimeoutMs: service.readyTimeoutMs } : {}),
	};
	return validateMcpConfig({
		mcpServers: {
			managed: {
				type: "stdio",
				command: process.execPath,
				args: [bridgeScriptPath(), JSON.stringify(spec)],
				env: { ELECTRON_RUN_AS_NODE: "1" },
				...(server.startupTimeout ? { startupTimeout: server.startupTimeout } : {}),
			},
		},
	}).mcpServers.managed as McpServerConfigData;
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

async function downloadArtifact(
	url: string,
	fetchArtifact: FetchArtifact,
	onProgress?: (downloadedBytes: number, totalBytes?: number) => void,
): Promise<Buffer> {
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
		const totalBytes = Number.isFinite(declaredLength) && declaredLength >= 0 ? declaredLength : undefined;
		onProgress?.(0, totalBytes);
		if (!response.body) {
			const buffer = Buffer.from(await response.arrayBuffer());
			if (buffer.byteLength > MAX_ARTIFACT_BYTES) throw new Error("MCP runtime artifact is too large");
			onProgress?.(buffer.byteLength, totalBytes ?? buffer.byteLength);
			return buffer;
		}
		const reader = response.body.getReader();
		const chunks: Buffer[] = [];
		let downloadedBytes = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				downloadedBytes += value.byteLength;
				if (downloadedBytes > MAX_ARTIFACT_BYTES) throw new Error("MCP runtime artifact is too large");
				chunks.push(Buffer.from(value));
				onProgress?.(downloadedBytes, totalBytes);
			}
		} finally {
			reader.releaseLock();
		}
		return Buffer.concat(chunks, downloadedBytes);
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
		const report = (
			phase: OpenMarketplaceMcpRuntimeProgressPhase,
			extra?: Partial<OpenMarketplaceMcpRuntimeProgress>,
		) => {
			try {
				input.onProgress?.({ sourceId: input.sourceId, slug: input.slug, phase, ...extra });
			} catch {
				// Progress delivery is best-effort and must never abort runtime preparation.
			}
		};
		report("preparing");
		try {
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
					const buffer = await downloadArtifact(platform.url, this.fetchArtifact, (downloadedBytes, totalBytes) =>
						report("downloading", { downloadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) }),
					);
					report("verifying", { downloadedBytes: buffer.byteLength, totalBytes: buffer.byteLength });
					const actualSha256 = createHash("sha256").update(buffer).digest("hex");
					if (actualSha256 !== platform.sha256) throw new Error("MCP runtime artifact SHA-256 mismatch");
					report("installing");
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
			const paths = {
				executable: executablePath,
				runtimeDirectory: targetDirectory,
				dataDirectory,
				cacheDirectory,
			};
			const server = input.runtime.service
				? input.server.type === "http"
					? (() => {
							throw new Error("Managed MCP runtimes require a stdio server");
						})()
					: resolveBridgedServer(input.server, input.runtime.service, paths)
				: resolveServer(input.server, paths);
			report("ready");
			return server;
		} catch (error) {
			report("failed");
			throw error;
		}
	}

	/**
	 * 受管能力的数据目录（Cookie 等登录态所在）。安装后步骤的完成判定读这里，
	 * 目录不随版本变化，卸载运行时也不会删除。
	 */
	dataDirectory(sourceId: string, slug: string): string {
		return join(this.rootDir, abilityDirectoryName(sourceId, slug), "data");
	}

	/** 安装后步骤是否已完成：由服务自己写出的标志文件（如 cookies.json）决定。 */
	isSetupComplete(sourceId: string, slug: string, dataFile: string): boolean {
		const relativePath = normalizedRelativePath(dataFile, "MCP setup data file");
		return existsSync(join(this.dataDirectory(sourceId, slug), ...relativePath.split("/")));
	}

	async remove(sourceId: string, slug: string): Promise<void> {
		const abilityDirectory = join(this.rootDir, abilityDirectoryName(sourceId, slug));
		await rm(join(abilityDirectory, "runtime"), { recursive: true, force: true });
	}
}
