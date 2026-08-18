import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import {
	assertThemeStorageWritable,
	isThemeStorageJson,
	isValidThemeStorageKey,
	isValidThemeStorageThemeId,
	type ThemeStorageJson,
} from "../../shared/theme-storage.js";
import { getAppLogger } from "../logger.js";
import { runThemeStorageFileMigrations } from "./migrations/index.js";
import {
	legacyThemeStorageFilePath,
	listThemeStorageValueFiles,
	themeStorageValuePath,
} from "./theme-storage-layout.js";

const log = getAppLogger("theme-data-store");

const memoryCache = new Map<string, Record<string, ThemeStorageJson>>();
const writeQueues = new Map<string, Promise<void>>();

function themesDataRoot(): string {
	return join(getVettaHomePath(), "desktop-app", "themes");
}

function themeDir(themeId: string): string {
	return join(themesDataRoot(), themeId);
}

function themeKeyPath(themeId: string, key: string): string {
	return themeStorageValuePath(themeDir(themeId), key);
}

function enqueueWrite<T>(themeId: string, task: () => Promise<T>): Promise<T> {
	const previous = writeQueues.get(themeId) ?? Promise.resolve();
	const next = previous.then(task, task);
	writeQueues.set(
		themeId,
		next.then(
			() => undefined,
			() => undefined,
		),
	);
	return next;
}

function emptyData(): Record<string, ThemeStorageJson> {
	return {};
}

async function readKeyFiles(themeId: string): Promise<Record<string, ThemeStorageJson>> {
	const dir = themeDir(themeId);
	if (!existsSync(dir)) return emptyData();

	const data: Record<string, ThemeStorageJson> = {};
	for (const file of await listThemeStorageValueFiles(dir)) {
		try {
			const raw = await readFile(file.path, "utf8");
			const value: unknown = JSON.parse(raw);
			if (!isThemeStorageJson(value)) {
				log.warn(`Skip invalid theme storage value file: ${themeId}/${file.fileName}`);
				continue;
			}
			data[file.key] = value;
		} catch (error) {
			log.warn(
				`Failed to read ${themeId}/${file.fileName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return data;
}

async function readFromDisk(themeId: string): Promise<Record<string, ThemeStorageJson>> {
	const dir = themeDir(themeId);
	if (!existsSync(dir)) return emptyData();

	if (existsSync(legacyThemeStorageFilePath(dir))) {
		try {
			await runThemeStorageFileMigrations(dir, log);
		} catch (error) {
			log.warn(
				`Failed to migrate theme storage files for "${themeId}": ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return readKeyFiles(themeId);
}

async function ensureLoaded(themeId: string): Promise<Record<string, ThemeStorageJson>> {
	if (!isValidThemeStorageThemeId(themeId)) {
		throw new Error(`Invalid theme storage themeId: ${themeId}`);
	}
	const cached = memoryCache.get(themeId);
	if (cached) return cached;
	const data = await readFromDisk(themeId);
	memoryCache.set(themeId, data);
	return data;
}

function cloneData(data: Record<string, ThemeStorageJson>): Record<string, ThemeStorageJson> {
	return { ...data };
}

export async function getThemeStorageData(themeId: string): Promise<Record<string, ThemeStorageJson>> {
	const data = await ensureLoaded(themeId);
	return cloneData(data);
}

export async function setThemeStorageValue(
	themeId: string,
	key: string,
	value: unknown,
): Promise<Record<string, ThemeStorageJson>> {
	return enqueueWrite(themeId, async () => {
		const current = await ensureLoaded(themeId);
		if (!isThemeStorageJson(value)) {
			throw new Error(`Theme storage value for "${key}" is not JSON-serializable`);
		}
		const next = { ...current, [key]: value };
		assertThemeStorageWritable(themeId, key, value, next);
		memoryCache.set(themeId, next);
		await atomicWriteJSONAsync(themeKeyPath(themeId, key), value);
		return cloneData(next);
	});
}

export async function removeThemeStorageValue(themeId: string, key: string): Promise<Record<string, ThemeStorageJson>> {
	return enqueueWrite(themeId, async () => {
		if (!isValidThemeStorageThemeId(themeId)) {
			throw new Error(`Invalid theme storage themeId: ${themeId}`);
		}
		if (!isValidThemeStorageKey(key)) {
			throw new Error(`Invalid theme storage key: ${key}`);
		}
		const current = await ensureLoaded(themeId);
		if (!(key in current)) return cloneData(current);
		const next = { ...current };
		delete next[key];
		memoryCache.set(themeId, next);
		const path = themeKeyPath(themeId, key);
		if (existsSync(path)) await unlink(path);
		return cloneData(next);
	});
}

export async function clearThemeStorage(themeId: string): Promise<Record<string, ThemeStorageJson>> {
	return enqueueWrite(themeId, async () => {
		if (!isValidThemeStorageThemeId(themeId)) {
			throw new Error(`Invalid theme storage themeId: ${themeId}`);
		}
		const current = await ensureLoaded(themeId);
		const next = emptyData();
		memoryCache.set(themeId, next);
		for (const key of Object.keys(current)) {
			const path = themeKeyPath(themeId, key);
			if (existsSync(path)) await unlink(path);
		}
		const legacyPath = legacyThemeStorageFilePath(themeDir(themeId));
		if (existsSync(legacyPath)) await unlink(legacyPath);
		return cloneData(next);
	});
}
