import type { ThemeStorage, ThemeStorageStatus, ThemeStorageValue } from "@vetta/theme-sdk/storage";
import {
	assertThemeStorageWritable,
	isThemeStorageJson,
	isValidThemeStorageKey,
	isValidThemeStorageThemeId,
	type ThemeStorageJson,
} from "@/shared/theme-storage";

interface CacheEntry {
	status: ThemeStorageStatus;
	data: Record<string, ThemeStorageJson>;
	revision: number;
	listeners: Set<() => void>;
	loadPromise: Promise<void> | null;
}

const caches = new Map<string, CacheEntry>();
let changeSubscriptionStarted = false;

function notify(entry: CacheEntry): void {
	entry.revision += 1;
	for (const listener of entry.listeners) listener();
}

function getOrCreate(themeId: string): CacheEntry {
	let entry = caches.get(themeId);
	if (entry) return entry;
	entry = {
		status: "loading",
		data: {},
		revision: 0,
		listeners: new Set(),
		loadPromise: null,
	};
	caches.set(themeId, entry);
	return entry;
}

function ensureChangeSubscription(): void {
	if (changeSubscriptionStarted) return;
	changeSubscriptionStarted = true;
	window.vetta.themes.storage.onChanged((event) => {
		if (!isValidThemeStorageThemeId(event.themeId)) return;
		const entry = getOrCreate(event.themeId);
		entry.data = event.data;
		entry.status = "ready";
		entry.loadPromise = null;
		notify(entry);
	});
}

function ensureLoaded(themeId: string): CacheEntry {
	if (!isValidThemeStorageThemeId(themeId)) {
		const entry = getOrCreate(themeId);
		entry.status = "error";
		entry.data = {};
		return entry;
	}
	ensureChangeSubscription();
	const entry = getOrCreate(themeId);
	if (entry.status === "ready" || entry.loadPromise) return entry;

	entry.status = "loading";
	const loadStartedAt = entry.revision;
	entry.loadPromise = window.vetta.themes.storage
		.getAll(themeId)
		.then((data) => {
			const current = getOrCreate(themeId);
			current.loadPromise = null;
			// Local writes may have advanced revision while load was in flight — do not clobber them.
			if (current.revision !== loadStartedAt) {
				if (current.status !== "ready") {
					current.status = "ready";
					notify(current);
				}
				return;
			}
			current.data = data;
			current.status = "ready";
			notify(current);
		})
		.catch((error) => {
			const current = getOrCreate(themeId);
			console.error(
				`[theme-storage] failed to load data for "${themeId}": ${error instanceof Error ? error.message : String(error)}`,
			);
			current.loadPromise = null;
			// Keep optimistic local data if any mutation already succeeded visually.
			if (current.revision !== loadStartedAt) {
				current.status = "ready";
			} else {
				current.status = "error";
			}
			notify(current);
		});
	return entry;
}

function applyLocalData(
	themeId: string,
	data: Record<string, ThemeStorageJson>,
	status: ThemeStorageStatus = "ready",
): void {
	const entry = getOrCreate(themeId);
	entry.data = data;
	entry.status = status;
	notify(entry);
}

export function getThemeStorageRevision(themeId: string): number {
	return ensureLoaded(themeId).revision;
}

export function getThemeStorageStatus(themeId: string): ThemeStorageStatus {
	return ensureLoaded(themeId).status;
}

export function createThemeStorage(themeId: string): ThemeStorage {
	const api: ThemeStorage = {
		themeId,
		get status() {
			return ensureLoaded(themeId).status;
		},
		get(key: string): ThemeStorageValue | undefined {
			const entry = ensureLoaded(themeId);
			if (entry.status !== "ready") return undefined;
			return entry.data[key] as ThemeStorageValue | undefined;
		},
		set(key: string, value: ThemeStorageValue): void {
			if (!isValidThemeStorageThemeId(themeId)) {
				console.error(`[theme-storage] invalid themeId: ${themeId}`);
				return;
			}
			if (!isValidThemeStorageKey(key)) {
				console.error(`[theme-storage] invalid key: ${key}`);
				return;
			}
			if (!isThemeStorageJson(value)) {
				console.error(`[theme-storage] value for "${key}" is not JSON-serializable`);
				return;
			}
			const entry = ensureLoaded(themeId);
			const previous = entry.data;
			const next = { ...entry.data, [key]: value };
			try {
				assertThemeStorageWritable(themeId, key, value, next);
			} catch (error) {
				console.error(`[theme-storage] ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			applyLocalData(themeId, next);
			void window.vetta.themes.storage.set(themeId, key, value).then(
				(data) => applyLocalData(themeId, data),
				(error) => {
					console.error(
						`[theme-storage] set failed for "${themeId}/${key}": ${error instanceof Error ? error.message : String(error)}`,
					);
					applyLocalData(themeId, previous);
				},
			);
		},
		remove(key: string): void {
			if (!isValidThemeStorageThemeId(themeId) || !isValidThemeStorageKey(key)) return;
			const entry = ensureLoaded(themeId);
			if (!(key in entry.data)) return;
			const previous = entry.data;
			const next = { ...entry.data };
			delete next[key];
			applyLocalData(themeId, next);
			void window.vetta.themes.storage.remove(themeId, key).then(
				(data) => applyLocalData(themeId, data),
				(error) => {
					console.error(
						`[theme-storage] remove failed for "${themeId}/${key}": ${error instanceof Error ? error.message : String(error)}`,
					);
					applyLocalData(themeId, previous);
				},
			);
		},
		clear(): void {
			if (!isValidThemeStorageThemeId(themeId)) return;
			const entry = ensureLoaded(themeId);
			const previous = entry.data;
			applyLocalData(themeId, {});
			void window.vetta.themes.storage.clear(themeId).then(
				(data) => applyLocalData(themeId, data),
				(error) => {
					console.error(
						`[theme-storage] clear failed for "${themeId}": ${error instanceof Error ? error.message : String(error)}`,
					);
					applyLocalData(themeId, previous);
				},
			);
		},
		subscribe(listener: () => void): () => void {
			const entry = ensureLoaded(themeId);
			entry.listeners.add(listener);
			return () => {
				entry.listeners.delete(listener);
			};
		},
	};
	return api;
}
