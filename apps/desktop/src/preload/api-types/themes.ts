export type DesktopThemePackageSource = "builtin" | "remote";

export interface DesktopThemePackage {
	id: string;
	displayName: Record<string, string>;
	version: string;
	sdkVersion: string;
	source: DesktopThemePackageSource;
	entryUrl: string;
	styleUrls: string[];
	moduleFederation: {
		remoteName: string;
		expose: string;
	};
}

/** JSON-serializable theme storage value (mirrors theme-sdk ThemeStorageValue). */
export type DesktopThemeStorageValue =
	| null
	| boolean
	| number
	| string
	| DesktopThemeStorageValue[]
	| { [key: string]: DesktopThemeStorageValue };

export interface DesktopThemeStorageChangedEvent {
	themeId: string;
	data: Record<string, DesktopThemeStorageValue>;
}

export interface DesktopThemeStorageApi {
	getAll(themeId: string): Promise<Record<string, DesktopThemeStorageValue>>;
	set(
		themeId: string,
		key: string,
		value: DesktopThemeStorageValue,
	): Promise<Record<string, DesktopThemeStorageValue>>;
	remove(themeId: string, key: string): Promise<Record<string, DesktopThemeStorageValue>>;
	clear(themeId: string): Promise<Record<string, DesktopThemeStorageValue>>;
	onChanged(handler: (event: DesktopThemeStorageChangedEvent) => void): () => void;
}

export interface DesktopThemesApi {
	list(): Promise<DesktopThemePackage[]>;
	storage: DesktopThemeStorageApi;
}
