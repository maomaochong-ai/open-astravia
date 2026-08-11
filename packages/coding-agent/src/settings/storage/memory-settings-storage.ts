import type { SettingsScope } from "../contracts/settings-document.js";
import type { SettingsStoragePort } from "../contracts/settings-storage.js";

export class MemorySettingsStorage implements SettingsStoragePort {
	private global: string | undefined;
	private project: string | undefined;

	withLock(scope: SettingsScope, operation: (current: string | undefined) => string | undefined): void {
		const next = operation(scope === "global" ? this.global : this.project);
		if (next === undefined) return;
		if (scope === "global") this.global = next;
		else this.project = next;
	}
}
