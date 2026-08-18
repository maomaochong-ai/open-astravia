import type { ColorMode } from "./contracts.js";

export interface ThemeWatchSubscription {
	close(): void;
}

export type ThemeWatchEvent = { readonly kind: "changed"; readonly content: string } | { readonly kind: "removed" };

/** Host-owned file watching. Theme parsing and fallback policy remain in the Coding Agent domain. */
export interface ThemeWatchPort {
	watch(path: string, listener: (event: ThemeWatchEvent) => void): ThemeWatchSubscription;
}

export interface ThemeRuntimeConfiguration {
	readonly colorMode: ColorMode;
	readonly defaultThemeName: "dark" | "light";
	readonly watcher?: ThemeWatchPort;
}

let configuration: ThemeRuntimeConfiguration = {
	colorMode: "truecolor",
	defaultThemeName: "dark",
};

/** Configure environment-dependent Theme defaults at an application Composition Root. */
export function configureThemeRuntime(next: ThemeRuntimeConfiguration): void {
	configuration = { ...next };
}

export function getThemeRuntimeConfiguration(): ThemeRuntimeConfiguration {
	return configuration;
}
