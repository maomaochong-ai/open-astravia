import type { SettingsDocument, SettingsScope } from "./settings-document.js";

export interface SettingsError {
	readonly scope: SettingsScope;
	readonly error: Error;
}

export interface SettingsLifecyclePort {
	getGlobalSettings(): SettingsDocument;
	getProjectSettings(): SettingsDocument;
	reload(): void;
	reloadImageSettings(): void;
	reloadPersonalizationSettings(): void;
	applyOverrides(overrides: Partial<SettingsDocument>): void;
	flush(): Promise<void>;
	drainErrors(): SettingsError[];
}
