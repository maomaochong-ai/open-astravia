import type { SettingsScope } from "./settings-document.js";

export interface SettingsStoragePort {
	withLock(scope: SettingsScope, operation: (current: string | undefined) => string | undefined): void;
}
