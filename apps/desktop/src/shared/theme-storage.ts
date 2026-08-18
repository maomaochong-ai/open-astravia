/** Shared validation for theme-owned storage (main + renderer). */

export const THEME_STORAGE_FILE_VERSION = 1;
/** Max serialized size of one theme's entire data map (UTF-8 bytes). */
export const THEME_STORAGE_MAX_BYTES = 256 * 1024;

const THEME_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const STORAGE_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type ThemeStorageJson =
	| null
	| boolean
	| number
	| string
	| ThemeStorageJson[]
	| { [key: string]: ThemeStorageJson };

export interface ThemeStorageFile {
	version: number;
	data: Record<string, ThemeStorageJson>;
}

export interface ThemeStorageChangedEvent {
	themeId: string;
	data: Record<string, ThemeStorageJson>;
}

export function isValidThemeStorageThemeId(themeId: string): boolean {
	return THEME_ID_RE.test(themeId) && !themeId.includes("..");
}

export function isValidThemeStorageKey(key: string): boolean {
	return STORAGE_KEY_RE.test(key);
}

export function isThemeStorageJson(value: unknown): value is ThemeStorageJson {
	if (value === null) return true;
	const t = typeof value;
	if (t === "boolean" || t === "string") return true;
	if (t === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isThemeStorageJson);
	if (t === "object") {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (typeof k !== "string") return false;
			if (!isThemeStorageJson(v)) return false;
		}
		return true;
	}
	return false;
}

export function measureThemeStorageBytes(data: Record<string, ThemeStorageJson>): number {
	return new TextEncoder().encode(JSON.stringify(data)).length;
}

export function assertThemeStorageWritable(
	themeId: string,
	key: string,
	value: unknown,
	nextData: Record<string, ThemeStorageJson>,
): void {
	if (!isValidThemeStorageThemeId(themeId)) {
		throw new Error(`Invalid theme storage themeId: ${themeId}`);
	}
	if (!isValidThemeStorageKey(key)) {
		throw new Error(`Invalid theme storage key: ${key}`);
	}
	if (!isThemeStorageJson(value)) {
		throw new Error(`Theme storage value for "${key}" is not JSON-serializable`);
	}
	const bytes = measureThemeStorageBytes(nextData);
	if (bytes > THEME_STORAGE_MAX_BYTES) {
		throw new Error(`Theme storage for "${themeId}" exceeds ${THEME_STORAGE_MAX_BYTES} bytes (got ${bytes})`);
	}
}
