export type ThemePackageSource = "builtin" | "remote";

export interface ThemePackageDescriptor {
	readonly id: string;
	readonly source: ThemePackageSource;
	readonly version: string;
	readonly sdkVersion: string;
	readonly displayName: Readonly<Record<string, string>>;
	readonly entryUrl: string;
}

export interface ThemeRuntimeValue {
	readonly activeThemeId: string;
	readonly availableThemes: readonly ThemePackageDescriptor[];
	readonly status: "ready" | "loading" | "error";
	selectTheme(themeId: string): Promise<void>;
}
