import { useThemeModule } from "@vetta/theme-sdk";
import type { ThemeStorage } from "@vetta/theme-sdk/storage";
import { useMemo, useSyncExternalStore } from "react";
import { createThemeStorage, getThemeStorageRevision } from "./themeStorageClient";

/**
 * Host implementation of theme-sdk `useThemeStorage`.
 * Binds storage to the active ThemeProvider module id.
 */
export function useThemeStorage(): ThemeStorage {
	const theme = useThemeModule();
	const themeId = theme.meta.id;
	const storage = useMemo(() => createThemeStorage(themeId), [themeId]);

	// Re-render when cache revision changes (load / write / remote broadcast).
	useSyncExternalStore(
		storage.subscribe,
		() => getThemeStorageRevision(themeId),
		() => 0,
	);

	return storage;
}
