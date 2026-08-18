import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, copyFile, cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { PluginPutBlobInput, PluginStoredBlob, PluginStoredBlobRef } from "@vetta-org/plugin-sdk";

interface BlobMetadata {
	mimeType: string;
	path?: string;
	extension?: string;
}

export interface PluginBlobFile {
	path: string;
	mimeType: string;
	sizeBytes: number;
}

const storageRoot = join(getVettaHomePath(), "plugin-data");
const legacyStorageRoot = join(getVettaHomePath(), "plugin-images");
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const storageMigrations = new Map<string, Promise<void>>();

function assertPluginId(pluginId: string): void {
	if (!SAFE_SEGMENT.test(pluginId) || pluginId === "." || pluginId === "..") {
		throw new Error("Invalid plugin id");
	}
}

function pluginRoot(pluginId: string): string {
	assertPluginId(pluginId);
	return join(storageRoot, pluginId);
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
			const legacyRoot = join(legacyStorageRoot, pluginId);
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

function scopedPath(pluginId: string, path: string): string {
	if (!path || isAbsolute(path) || path.includes("\0")) {
		throw new Error("Invalid plugin storage path");
	}
	const root = resolve(pluginRoot(pluginId));
	const target = resolve(root, path);
	const relation = relative(root, target);
	if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
		throw new Error("Plugin storage path escapes its namespace");
	}
	return target;
}

function mediaUrl(path: string, mimeType: string): string {
	return `vetta-media://local/stream?path=${encodeURIComponent(path)}&mime=${encodeURIComponent(mimeType)}`;
}

async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, data);
	await rename(temporaryPath, path);
}

async function atomicCopy(sourcePath: string, targetPath: string): Promise<void> {
	await mkdir(dirname(targetPath), { recursive: true });
	const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
	await copyFile(sourcePath, temporaryPath);
	await rename(temporaryPath, targetPath);
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
		const path = join(current, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(root, path)));
		} else if (entry.isFile()) {
			files.push(relative(root, path).split(sep).join("/"));
		}
	}
	return files;
}

export async function readPluginJson<T>(pluginId: string, key: string): Promise<T | null> {
	await ensurePluginStorage(pluginId);
	try {
		const raw = await readFile(scopedPath(pluginId, key), "utf8");
		return JSON.parse(raw) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export async function writePluginJson(pluginId: string, key: string, value: unknown): Promise<void> {
	await ensurePluginStorage(pluginId);
	await atomicWrite(scopedPath(pluginId, key), JSON.stringify(value, null, 2));
}

export async function listPluginFiles(pluginId: string, prefix = "."): Promise<string[]> {
	await ensurePluginStorage(pluginId);
	const root = pluginRoot(pluginId);
	return listFiles(root, scopedPath(pluginId, prefix));
}

export async function readPluginFile(pluginId: string, path: string): Promise<string | null> {
	await ensurePluginStorage(pluginId);
	try {
		return (await readFile(scopedPath(pluginId, path))).toString("base64");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export async function writePluginFile(pluginId: string, path: string, data: string): Promise<void> {
	await ensurePluginStorage(pluginId);
	await atomicWrite(scopedPath(pluginId, path), Buffer.from(data, "base64"));
}

export async function putPluginBlob(pluginId: string, input: PluginPutBlobInput): Promise<PluginStoredBlobRef> {
	await ensurePluginStorage(pluginId);
	const id = input.id ?? randomUUID();
	if (!SAFE_SEGMENT.test(id) || id === "." || id === "..") {
		throw new Error("Invalid blob id");
	}
	const relativePath = `blobs/${id}.blob`;
	const blobPath = scopedPath(pluginId, relativePath);
	await atomicWrite(blobPath, Buffer.from(input.data, "base64"));
	await writePluginJson(pluginId, `blob-metadata/${id}.json`, {
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
	if (!SAFE_SEGMENT.test(id) || id === "." || id === "..") {
		throw new Error("Invalid blob id");
	}
	const relativePath = `blobs/${id}.blob`;
	const blobPath = scopedPath(pluginId, relativePath);
	await atomicCopy(input.path, blobPath);
	await writePluginJson(pluginId, `blob-metadata/${id}.json`, {
		mimeType: input.mimeType,
		path: relativePath,
	} satisfies BlobMetadata);
	return { id, url: mediaUrl(blobPath, input.mimeType), mimeType: input.mimeType };
}

export async function readPluginBlob(pluginId: string, id: string): Promise<PluginStoredBlob | null> {
	const metadata = await readPluginJson<BlobMetadata>(pluginId, `blob-metadata/${id}.json`);
	if (!metadata) return null;
	const data = await readPluginFile(pluginId, metadata.path ?? `blobs/${id}.${metadata.extension ?? "blob"}`);
	return data ? { data, mimeType: metadata.mimeType } : null;
}

export async function getPluginBlobRef(pluginId: string, id: string): Promise<PluginStoredBlobRef | null> {
	const metadata = await readPluginJson<BlobMetadata>(pluginId, `blob-metadata/${id}.json`);
	if (!metadata) return null;
	const blobPath = scopedPath(pluginId, metadata.path ?? `blobs/${id}.${metadata.extension ?? "blob"}`);
	return { id, url: mediaUrl(blobPath, metadata.mimeType), mimeType: metadata.mimeType };
}

export async function getPluginBlobFile(pluginId: string, id: string): Promise<PluginBlobFile | null> {
	const metadata = await readPluginJson<BlobMetadata>(pluginId, `blob-metadata/${id}.json`);
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
