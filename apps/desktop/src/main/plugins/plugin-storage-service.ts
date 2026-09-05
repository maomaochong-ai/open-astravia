import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { PluginPutBlobInput, PluginStoredBlob, PluginStoredBlobRef } from "@vetta-org/plugin-sdk";

export type PluginStorageEncoding = "utf8" | "base64";
export interface PluginStorageWrite {
	path: string;
	data: string;
	encoding: PluginStorageEncoding;
}
export type PluginStorageCommitEntry = ({ type: "write" } & PluginStorageWrite) | { type: "remove"; path: string };
export interface PluginStorageSnapshot {
	revision: string;
	files: Record<string, string | null>;
}

export class PluginStorageConflictError extends Error {
	readonly name = "PluginStorageConflictError";
}

interface BlobMetadata {
	mimeType: string;
	path?: string;
	extension?: string;
}
interface StorageFileEntry {
	objectId: string;
	sizeBytes: number;
	modifiedAt: number;
}
interface StorageManifest {
	schemaVersion: 1;
	revision: string;
	files: Record<string, StorageFileEntry>;
}
export interface PluginBlobFile {
	path: string;
	mimeType: string;
	sizeBytes: number;
}

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const storageMigrations = new Map<string, Promise<void>>();
const storageLocks = new Map<string, Promise<void>>();

function assertPluginId(pluginId: string): void {
	if (!SAFE_SEGMENT.test(pluginId) || pluginId === "." || pluginId === "..") throw new Error("Invalid plugin id");
}
function pluginRoot(pluginId: string): string {
	assertPluginId(pluginId);
	return join(getVettaHomePath(), "plugin-data", pluginId);
}
function storageMetaRoot(pluginId: string): string {
	return join(pluginRoot(pluginId), ".storage");
}
function storageHeadPath(pluginId: string): string {
	return join(storageMetaRoot(pluginId), "HEAD");
}
function storageRevisionPath(pluginId: string, revision: string): string {
	if (!SAFE_SEGMENT.test(revision)) throw new Error("Invalid storage revision");
	return join(storageMetaRoot(pluginId), "revisions", `${revision}.json`);
}
function storageObjectPath(pluginId: string, objectId: string): string {
	if (!SAFE_SEGMENT.test(objectId)) throw new Error("Invalid storage object");
	return join(storageMetaRoot(pluginId), "objects", `${objectId}.bin`);
}
async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
async function ensurePluginStorage(pluginId: string): Promise<void> {
	assertPluginId(pluginId);
	const existing = storageMigrations.get(pluginId);
	if (existing) return existing;
	const migration = (async () => {
		const root = pluginRoot(pluginId);
		if (!(await pathExists(root))) {
			const legacyRoot = join(getVettaHomePath(), "plugin-images", pluginId);
			if (await pathExists(legacyRoot)) {
				await mkdir(dirname(root), { recursive: true });
				await cp(legacyRoot, root, { recursive: true, errorOnExist: true, force: false });
			}
		}
		await mkdir(root, { recursive: true });
	})();
	storageMigrations.set(pluginId, migration);
	try {
		await migration;
	} catch (error) {
		storageMigrations.delete(pluginId);
		throw error;
	}
}
async function withStorageLock<T>(pluginId: string, operation: () => Promise<T>): Promise<T> {
	const previous = storageLocks.get(pluginId) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolveRelease) => {
		release = resolveRelease;
	});
	const queued = previous.then(() => current);
	storageLocks.set(pluginId, queued);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (storageLocks.get(pluginId) === queued) storageLocks.delete(pluginId);
	}
}
function scopedPath(pluginId: string, path: string): string {
	if (!path || isAbsolute(path) || path.includes("\0")) throw new Error("Invalid plugin storage path");
	const root = resolve(pluginRoot(pluginId));
	const target = resolve(root, path);
	const relation = relative(root, target);
	if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation))
		throw new Error("Plugin storage path escapes its namespace");
	if (relation === ".storage" || relation.startsWith(`.storage${sep}`))
		throw new Error("Plugin storage metadata path is reserved");
	return target;
}
function normalizeStoragePath(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	if (
		!normalized ||
		normalized.includes("\0") ||
		normalized.startsWith("/") ||
		/^[a-zA-Z]:\//.test(normalized) ||
		normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
	)
		throw new Error("Invalid plugin storage path");
	if (normalized === ".storage" || normalized.startsWith(".storage/"))
		throw new Error("Plugin storage metadata path is reserved");
	return normalized;
}
function mediaUrl(path: string, mimeType: string): string {
	return `vetta-media://local/stream?path=${encodeURIComponent(path)}&mime=${encodeURIComponent(mimeType)}`;
}
async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, data);
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
async function atomicCopy(sourcePath: string, targetPath: string): Promise<void> {
	await mkdir(dirname(targetPath), { recursive: true });
	const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
	try {
		await copyFile(sourcePath, temporaryPath);
		await rename(temporaryPath, targetPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
async function listFiles(root: string, current: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(current, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const files: string[] = [];
	for (const entry of entries) {
		if (
			current === root &&
			(entry.name === ".storage" ||
				entry.name === ".transactions" ||
				entry.name === "blobs" ||
				entry.name === "blob-metadata")
		)
			continue;
		const path = join(current, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
		else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
	}
	return files;
}
async function readLegacyJson<T>(pluginId: string, path: string): Promise<T | null> {
	await ensurePluginStorage(pluginId);
	try {
		return JSON.parse(await readFile(scopedPath(pluginId, path), "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
async function writeLegacyJson(pluginId: string, path: string, value: unknown): Promise<void> {
	await ensurePluginStorage(pluginId);
	await atomicWrite(scopedPath(pluginId, path), JSON.stringify(value, null, 2));
}
async function readManifest(pluginId: string): Promise<StorageManifest> {
	await ensurePluginStorage(pluginId);
	const headPath = storageHeadPath(pluginId);
	if (!(await pathExists(headPath))) {
		const revision = randomUUID();
		const files: Record<string, StorageFileEntry> = {};
		for (const path of await listFiles(pluginRoot(pluginId), pluginRoot(pluginId))) {
			const bytes = await readFile(scopedPath(pluginId, path));
			const objectId = randomUUID();
			await atomicWrite(storageObjectPath(pluginId, objectId), bytes);
			const file = await stat(scopedPath(pluginId, path));
			files[path] = { objectId, sizeBytes: bytes.byteLength, modifiedAt: file.mtimeMs };
		}
		const manifest: StorageManifest = { schemaVersion: 1, revision, files };
		await atomicWrite(storageRevisionPath(pluginId, revision), JSON.stringify(manifest));
		await atomicWrite(headPath, revision);
		return manifest;
	}
	const revision = (await readFile(headPath, "utf8")).trim();
	if (!revision) throw new Error("Plugin storage HEAD is empty");
	return JSON.parse(await readFile(storageRevisionPath(pluginId, revision), "utf8")) as StorageManifest;
}
function decodeStorageData(data: string, encoding: PluginStorageEncoding): Buffer {
	return encoding === "base64" ? Buffer.from(data, "base64") : Buffer.from(data, "utf8");
}
function encodeStorageData(data: Buffer, encoding: PluginStorageEncoding): string {
	return encoding === "base64" ? data.toString("base64") : data.toString("utf8");
}

async function pruneStorageHistory(
	pluginId: string,
	current: StorageManifest,
	previous: StorageManifest,
): Promise<void> {
	const retainedRevisions = new Set([current.revision, previous.revision]);
	const retainedObjects = new Set(
		[...Object.values(current.files), ...Object.values(previous.files)].map((entry) => entry.objectId),
	);
	for (const entry of await readdir(join(storageMetaRoot(pluginId), "revisions"), { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const revision = entry.name.slice(0, -".json".length);
		if (!retainedRevisions.has(revision)) await rm(join(storageMetaRoot(pluginId), "revisions", entry.name));
	}
	for (const entry of await readdir(join(storageMetaRoot(pluginId), "objects"), { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".bin")) continue;
		const objectId = entry.name.slice(0, -".bin".length);
		if (!retainedObjects.has(objectId)) await rm(join(storageMetaRoot(pluginId), "objects", entry.name));
	}
}
export async function commitPluginStorage(
	pluginId: string,
	entries: readonly PluginStorageCommitEntry[],
	expectedRevision?: string,
): Promise<{ revision: string; changedPaths: string[] }> {
	return withStorageLock(pluginId, async () => {
		if (entries.length === 0 || entries.length > 128)
			throw new Error("Plugin storage commit must contain between 1 and 128 changes");
		const manifest = await readManifest(pluginId);
		if (expectedRevision !== undefined && expectedRevision !== manifest.revision)
			throw new PluginStorageConflictError(
				`Plugin storage revision conflict: expected ${expectedRevision}, current ${manifest.revision}`,
			);
		const normalized = entries.map((entry) => ({ ...entry, path: normalizeStoragePath(entry.path) }));
		const paths = new Set<string>();
		for (const entry of normalized) {
			if (paths.has(entry.path)) throw new Error("Duplicate plugin storage commit path");
			paths.add(entry.path);
		}
		const files = { ...manifest.files };
		for (const entry of normalized) {
			if (entry.type === "remove") {
				delete files[entry.path];
				continue;
			}
			const objectId = randomUUID();
			const bytes = decodeStorageData(entry.data, entry.encoding);
			await atomicWrite(storageObjectPath(pluginId, objectId), bytes);
			files[entry.path] = { objectId, sizeBytes: bytes.byteLength, modifiedAt: Date.now() };
		}
		const revision = randomUUID();
		const nextManifest: StorageManifest = { schemaVersion: 1, revision, files };
		await atomicWrite(storageRevisionPath(pluginId, revision), JSON.stringify(nextManifest));
		await atomicWrite(storageHeadPath(pluginId), revision);
		await pruneStorageHistory(pluginId, nextManifest, manifest).catch(() => undefined);
		return { revision, changedPaths: normalized.map((entry) => entry.path) };
	});
}
export async function readPluginStorageSnapshot(
	pluginId: string,
	paths: readonly string[],
	encoding: PluginStorageEncoding = "utf8",
): Promise<PluginStorageSnapshot> {
	return withStorageLock(pluginId, async () => {
		const manifest = await readManifest(pluginId);
		const files: Record<string, string | null> = {};
		for (const rawPath of paths) {
			const path = normalizeStoragePath(rawPath);
			const entry = manifest.files[path];
			files[path] = entry
				? encodeStorageData(await readFile(storageObjectPath(pluginId, entry.objectId)), encoding)
				: null;
		}
		return { revision: manifest.revision, files };
	});
}
export async function listPluginFiles(pluginId: string, prefix = ""): Promise<string[]> {
	return withStorageLock(pluginId, async () => {
		const manifest = await readManifest(pluginId);
		const normalizedPrefix = prefix ? normalizeStoragePath(prefix).replace(/\/$/, "") : "";
		return Object.keys(manifest.files)
			.filter((path) => !normalizedPrefix || path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`))
			.sort();
	});
}
export async function readPluginFile(
	pluginId: string,
	path: string,
	encoding: PluginStorageEncoding,
): Promise<string | null> {
	return (await readPluginStorageSnapshot(pluginId, [path], encoding)).files[normalizeStoragePath(path)] ?? null;
}
export async function writePluginFile(
	pluginId: string,
	path: string,
	data: string,
	encoding: PluginStorageEncoding,
): Promise<{ revision: string; changedPaths: string[] }> {
	return commitPluginStorage(pluginId, [{ type: "write", path, data, encoding }]);
}
export async function putPluginBlob(pluginId: string, input: PluginPutBlobInput): Promise<PluginStoredBlobRef> {
	await ensurePluginStorage(pluginId);
	const id = input.id ?? randomUUID();
	if (!SAFE_SEGMENT.test(id) || id === "." || id === "..") throw new Error("Invalid blob id");
	const relativePath = `blobs/${id}.blob`;
	const blobPath = scopedPath(pluginId, relativePath);
	await atomicWrite(blobPath, Buffer.from(input.data, "base64"));
	await writeLegacyJson(pluginId, `blob-metadata/${id}.json`, {
		mimeType: input.mimeType,
		path: relativePath,
	} satisfies BlobMetadata);
	return { id, url: mediaUrl(blobPath, input.mimeType), mimeType: input.mimeType };
}
export async function putPluginBlobFromFile(
	pluginId: string,
	input: { id?: string; path: string; mimeType: string },
): Promise<PluginStoredBlobRef> {
	await ensurePluginStorage(pluginId);
	const id = input.id ?? randomUUID();
	if (!SAFE_SEGMENT.test(id) || id === "." || id === "..") throw new Error("Invalid blob id");
	const relativePath = `blobs/${id}.blob`;
	const blobPath = scopedPath(pluginId, relativePath);
	await atomicCopy(input.path, blobPath);
	await writeLegacyJson(pluginId, `blob-metadata/${id}.json`, {
		mimeType: input.mimeType,
		path: relativePath,
	} satisfies BlobMetadata);
	return { id, url: mediaUrl(blobPath, input.mimeType), mimeType: input.mimeType };
}
export async function readPluginBlob(pluginId: string, id: string): Promise<PluginStoredBlob | null> {
	const metadata = await readLegacyJson<BlobMetadata>(pluginId, `blob-metadata/${id}.json`);
	if (!metadata) return null;
	try {
		return {
			data: (
				await readFile(scopedPath(pluginId, metadata.path ?? `blobs/${id}.${metadata.extension ?? "blob"}`))
			).toString("base64"),
			mimeType: metadata.mimeType,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
export async function getPluginBlobRef(pluginId: string, id: string): Promise<PluginStoredBlobRef | null> {
	const metadata = await readLegacyJson<BlobMetadata>(pluginId, `blob-metadata/${id}.json`);
	if (!metadata) return null;
	const blobPath = scopedPath(pluginId, metadata.path ?? `blobs/${id}.${metadata.extension ?? "blob"}`);
	return { id, url: mediaUrl(blobPath, metadata.mimeType), mimeType: metadata.mimeType };
}
export async function getPluginBlobFile(pluginId: string, id: string): Promise<PluginBlobFile | null> {
	const metadata = await readLegacyJson<BlobMetadata>(pluginId, `blob-metadata/${id}.json`);
	if (!metadata) return null;
	const path = scopedPath(pluginId, metadata.path ?? `blobs/${id}.${metadata.extension ?? "blob"}`);
	try {
		const file = await stat(path);
		return { path, mimeType: metadata.mimeType, sizeBytes: file.size };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
