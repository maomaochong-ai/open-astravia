import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { listPluginManifestResources, parsePluginManifest, type PluginManifest } from "@vetta-org/plugin-sdk/manifest";

export interface VettaPluginPackageFile {
	fullPath: string;
	archivePath: string;
}

export interface VettaPluginPackageResult {
	outputPath: string;
	files: VettaPluginPackageFile[];
}

export interface CreateVettaPluginPackageOptions {
	rootDir?: string;
	manifestPath?: string;
	releaseDir?: string;
	distDir?: string;
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
	let value = i;
	for (let bit = 0; bit < 8; bit += 1) {
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	crcTable[i] = value >>> 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function validateAbilityDescriptor(value: unknown, pluginManifest: PluginManifest): void {
	if (!isRecord(value)) throw new Error("ability.json must contain an object.");
	if (
		value.schemaVersion !== 1 ||
		value.type !== "plugin" ||
		value.slug !== pluginManifest.id ||
		value.version !== pluginManifest.version
	) {
		throw new Error("ability.json identity must match plugin.json id and version.");
	}
}

function parseJsonObject(buffer: Buffer, fileName: string): Record<string, unknown> {
	const parsed = JSON.parse(buffer.toString("utf-8")) as unknown;
	if (!isRecord(parsed)) {
		throw new Error(`${fileName} must contain an object.`);
	}
	return parsed;
}

function crc32(buffer: Buffer): number {
	let value = 0xffffffff;
	for (const byte of buffer) {
		value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
	}
	return (value ^ 0xffffffff) >>> 0;
}

function writeUInt16(value: number): Buffer {
	const buffer = Buffer.allocUnsafe(2);
	buffer.writeUInt16LE(value, 0);
	return buffer;
}

function writeUInt32(value: number): Buffer {
	const buffer = Buffer.allocUnsafe(4);
	buffer.writeUInt32LE(value >>> 0, 0);
	return buffer;
}

function archivePathFromRoot(rootDir: string, fullPath: string): string {
	const archivePath = relative(rootDir, fullPath).replace(/\\/g, "/");
	if (!archivePath || archivePath.startsWith("..") || archivePath.includes(`${sep}..${sep}`)) {
		throw new Error(`File is outside plugin root: ${fullPath}`);
	}
	return archivePath;
}

async function collectFiles(dir: string): Promise<VettaPluginPackageFile[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: VettaPluginPackageFile[] = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(fullPath)));
		} else if (entry.isFile()) {
			files.push({ fullPath, archivePath: "" });
		}
	}
	return files;
}

async function collectPath(path: string): Promise<VettaPluginPackageFile[]> {
	const info = await stat(path);
	if (info.isDirectory()) {
		return collectFiles(path);
	}
	if (info.isFile()) {
		return [{ fullPath: path, archivePath: "" }];
	}
	return [];
}

async function createZip(files: VettaPluginPackageFile[]): Promise<Buffer> {
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let offset = 0;

	for (const file of files) {
		const data = await readFile(file.fullPath);
		const name = Buffer.from(file.archivePath.replace(/\\/g, "/"));
		const checksum = crc32(data);
		const localHeader = Buffer.concat([
			writeUInt32(0x04034b50),
			writeUInt16(20),
			writeUInt16(0),
			writeUInt16(0),
			writeUInt16(0),
			writeUInt16(0),
			writeUInt32(checksum),
			writeUInt32(data.length),
			writeUInt32(data.length),
			writeUInt16(name.length),
			writeUInt16(0),
			name,
		]);
		localParts.push(localHeader, data);

		centralParts.push(
			Buffer.concat([
				writeUInt32(0x02014b50),
				writeUInt16(20),
				writeUInt16(20),
				writeUInt16(0),
				writeUInt16(0),
				writeUInt16(0),
				writeUInt16(0),
				writeUInt32(checksum),
				writeUInt32(data.length),
				writeUInt32(data.length),
				writeUInt16(name.length),
				writeUInt16(0),
				writeUInt16(0),
				writeUInt16(0),
				writeUInt16(0),
				writeUInt32(0),
				writeUInt32(offset),
				name,
			]),
		);
		offset += localHeader.length + data.length;
	}

	const centralDirectory = Buffer.concat(centralParts);
	const endOfCentralDirectory = Buffer.concat([
		writeUInt32(0x06054b50),
		writeUInt16(0),
		writeUInt16(0),
		writeUInt16(files.length),
		writeUInt16(files.length),
		writeUInt32(centralDirectory.length),
		writeUInt32(offset),
		writeUInt16(0),
	]);

	return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function readManifestRemoteEntry(manifest: Record<string, unknown>): string | undefined {
	const metaData = manifest.metaData;
	if (!isRecord(metaData)) {
		return undefined;
	}
	const remoteEntry = metaData.remoteEntry;
	if (!isRecord(remoteEntry)) {
		return undefined;
	}
	const name = readString(remoteEntry, "name");
	if (!name) {
		return undefined;
	}
	const path = readString(remoteEntry, "path") ?? "";
	return path ? `${path.replace(/\/$/, "")}/${name}` : name;
}

async function collectRuntimeFiles(
	rootDir: string,
	manifestPath: string,
	distDir: string,
): Promise<VettaPluginPackageFile[]> {
	const pluginManifest = parsePluginManifest(parseJsonObject(await readFile(manifestPath), basename(manifestPath)));
	const packageFiles = new Map<string, VettaPluginPackageFile>();
	const addFile = (fullPath: string) => {
		const resolved = resolve(fullPath);
		const archivePath = archivePathFromRoot(rootDir, resolved);
		packageFiles.set(archivePath, { fullPath: resolved, archivePath });
	};

	addFile(manifestPath);

	// 插件详情跟随插件包发布；ability.json 缺省兼容，存在时必须与 plugin.json 身份一致。
	const abilityDescriptorPath = resolve(rootDir, "ability.json");
	if (existsSync(abilityDescriptorPath)) {
		validateAbilityDescriptor(
			parseJsonObject(await readFile(abilityDescriptorPath), basename(abilityDescriptorPath)),
			pluginManifest,
		);
		addFile(abilityDescriptorPath);
		// 约定的展示资源目录；内联 blocks 可引用其中的图片，随包整体带上。
		try {
			for (const file of await collectFiles(resolve(rootDir, "presentation"))) {
				addFile(file.fullPath);
			}
		} catch {
			// optional presentation/ directory
		}
	}

	const runtimeEntryPath = resolve(rootDir, pluginManifest.entry);
	addFile(runtimeEntryPath);

	if (pluginManifest.runtime === "module-federation") {
		const federationManifest = parseJsonObject(await readFile(runtimeEntryPath), basename(runtimeEntryPath));
		const remoteEntry = readManifestRemoteEntry(federationManifest);
		if (remoteEntry) {
			addFile(resolve(dirname(runtimeEntryPath), remoteEntry));
		}

		const assetsDir = join(distDir, "assets");
		for (const file of await collectFiles(assetsDir)) {
			addFile(file.fullPath);
		}

		// Vite cssCodeSplit emits extra files like dist/style2.css for async chunks;
		// include all dist-root CSS so preload-helper can fetch them (not only styles[]).
		try {
			for (const file of await collectFiles(distDir)) {
				const rel = relative(distDir, file.fullPath).replace(/\\/g, "/");
				if (rel.endsWith(".css") && !rel.includes("/")) {
					addFile(file.fullPath);
				}
			}
		} catch {
			// dist missing
		}
	}

	for (const resource of listPluginManifestResources(pluginManifest)) {
		if (resource.field === "entry") continue;
		const resourcePath = resolve(rootDir, resource.path);
		if (resource.kind === "file") {
			if (!existsSync(resourcePath)) {
				throw new Error(`plugin.json resource not found: ${resource.field} (${resource.path})`);
			}
			addFile(resourcePath);
			continue;
		}
		for (const file of await collectPath(resourcePath)) {
			addFile(file.fullPath);
		}
	}

	// Plugin-scoped MCP: include config file and conventional companion dirs when declared.
	const mcpServers = pluginManifest.agent?.mcpServers;
	if (mcpServers !== undefined) {
		try {
			for (const file of await collectFiles(resolve(rootDir, "mcp"))) {
				addFile(file.fullPath);
			}
		} catch {
			// optional mcp/ directory
		}
	}

	// Helper scripts (plugin workbench etc.): always pack scripts/ when present.
	try {
		for (const file of await collectFiles(resolve(rootDir, "scripts"))) {
			addFile(file.fullPath);
		}
	} catch {
		// optional scripts/ directory
	}

	// Handbook / agent docs beside skills (not always listed in skillPaths).
	try {
		for (const file of await collectFiles(resolve(rootDir, "agent/docs"))) {
			addFile(file.fullPath);
		}
	} catch {
		// optional agent/docs
	}

	// Plugin i18n catalogs (ADR-0033): bundle locales/<lang>.json so the host can
	// load them alongside the manifest. Optional — absent for single-language plugins.
	try {
		for (const file of await collectFiles(resolve(rootDir, "locales"))) {
			addFile(file.fullPath);
		}
	} catch {
		// no locales/ directory — nothing to bundle
	}

	return [...packageFiles.values()].sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}

export async function createVettaPluginPackage(
	options: CreateVettaPluginPackageOptions = {},
): Promise<VettaPluginPackageResult> {
	const rootDir = resolve(options.rootDir ?? process.cwd());
	const manifestPath = resolve(rootDir, options.manifestPath ?? "plugin.json");
	const releaseDir = resolve(rootDir, options.releaseDir ?? "release");
	const distDir = resolve(rootDir, options.distDir ?? "dist");
	const pluginManifest = parsePluginManifest(parseJsonObject(await readFile(manifestPath), basename(manifestPath)));
	const outputPath = join(releaseDir, `${pluginManifest.id}-${pluginManifest.version}.zip`);
	const files = await collectRuntimeFiles(rootDir, manifestPath, distDir);

	await mkdir(releaseDir, { recursive: true });
	await rm(outputPath, { force: true });
	await writeFile(outputPath, await createZip(files));

	return { outputPath, files };
}
