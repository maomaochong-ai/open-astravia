import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";
import type { KeyValueStore } from "../types";

/** Secrets: iOS Keychain / Android Keystore via expo-secure-store. */
export class SecureKeyValueStore implements KeyValueStore {
	async get(key: string): Promise<string | null> {
		return SecureStore.getItemAsync(sanitize(key));
	}

	async set(key: string, value: string): Promise<void> {
		await SecureStore.setItemAsync(sanitize(key), value, {
			keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
		});
	}

	async remove(key: string): Promise<void> {
		await SecureStore.deleteItemAsync(sanitize(key));
	}
}

/** Non-secret settings: SQLite-backed key/value store shipped with expo-sqlite. */
export class SettingsKeyValueStore implements KeyValueStore {
	async get(key: string): Promise<string | null> {
		return Storage.getItemAsync(key);
	}

	async set(key: string, value: string): Promise<void> {
		await Storage.setItemAsync(key, value);
	}

	async remove(key: string): Promise<void> {
		await Storage.removeItemAsync(key);
	}
}

/** SecureStore keys may only contain alphanumerics, ".", "-" and "_". */
function sanitize(key: string): string {
	return key.replace(/[^A-Za-z0-9._-]/g, "_");
}
