import type { SettingsDocument, SettingsScope } from "../contracts/settings-document.js";
import type { SettingsError } from "../contracts/settings-lifecycle.js";
import type { SettingsStoragePort } from "../contracts/settings-storage.js";
import { decodeSettingsDocument } from "../schema/settings-schema.js";
import { applySettingsPatch, mergeSettings } from "../state/merge-settings.js";
import { createSettingsChangeSet, type SettingsChange } from "../state/settings-change-set.js";

export interface SettingsStatePort {
	read(): SettingsDocument;
	readGlobal(): SettingsDocument;
	readProject(): SettingsDocument;
	patchGlobal(patch: Partial<SettingsDocument>): void;
	patchProject(patch: Partial<SettingsDocument>): void;
	applyOverrides(overrides: Partial<SettingsDocument>): void;
	reload(): void;
	reloadSection(section: "images" | "personalization"): void;
	readFreshGlobal<K extends keyof SettingsDocument>(key: K): SettingsDocument[K];
	flush(): Promise<void>;
	drainErrors(): SettingsError[];
}

interface SettingsLoadResult {
	readonly settings: SettingsDocument;
	readonly error: Error | null;
}

export class SettingsState implements SettingsStatePort {
	private globalSettings: SettingsDocument;
	private projectSettings: SettingsDocument;
	private effectiveSettings: SettingsDocument;
	private globalLoadError: Error | null;
	private projectLoadError: Error | null;
	private writeQueue: Promise<void> = Promise.resolve();
	private errors: SettingsError[];

	private constructor(
		private readonly storage: SettingsStoragePort,
		globalLoad: SettingsLoadResult,
		projectLoad: SettingsLoadResult,
	) {
		this.globalSettings = globalLoad.settings;
		this.projectSettings = projectLoad.settings;
		this.globalLoadError = globalLoad.error;
		this.projectLoadError = projectLoad.error;
		this.errors = [
			...(globalLoad.error ? [{ scope: "global" as const, error: globalLoad.error }] : []),
			...(projectLoad.error ? [{ scope: "project" as const, error: projectLoad.error }] : []),
		];
		this.effectiveSettings = mergeSettings(this.globalSettings, this.projectSettings);
	}

	static load(storage: SettingsStoragePort): SettingsState {
		return new SettingsState(storage, loadScope(storage, "global"), loadScope(storage, "project"));
	}

	static inMemory(storage: SettingsStoragePort, initial: Partial<SettingsDocument>): SettingsState {
		return new SettingsState(
			storage,
			{ settings: structuredClone(initial), error: null },
			{ settings: {}, error: null },
		);
	}

	read(): SettingsDocument {
		return structuredClone(this.effectiveSettings);
	}

	readGlobal(): SettingsDocument {
		return structuredClone(this.globalSettings);
	}

	readProject(): SettingsDocument {
		return structuredClone(this.projectSettings);
	}

	patchGlobal(patch: Partial<SettingsDocument>): void {
		this.globalSettings = applySettingsPatch(this.globalSettings, patch);
		this.rebuildEffectiveSettings();
		if (this.globalLoadError) return;
		this.enqueueWrite("global", this.globalSettings, createSettingsChangeSet(patch));
	}

	patchProject(patch: Partial<SettingsDocument>): void {
		this.projectSettings = applySettingsPatch(this.projectSettings, patch);
		this.rebuildEffectiveSettings();
		if (this.projectLoadError) return;
		this.enqueueWrite("project", this.projectSettings, createSettingsChangeSet(patch));
	}

	applyOverrides(overrides: Partial<SettingsDocument>): void {
		this.effectiveSettings = mergeSettings(this.effectiveSettings, overrides);
	}

	reload(): void {
		const globalLoad = loadScope(this.storage, "global");
		if (globalLoad.error) {
			this.globalLoadError = globalLoad.error;
			this.recordError("global", globalLoad.error);
		} else {
			this.globalSettings = globalLoad.settings;
			this.globalLoadError = null;
		}

		const projectLoad = loadScope(this.storage, "project");
		if (projectLoad.error) {
			this.projectLoadError = projectLoad.error;
			this.recordError("project", projectLoad.error);
		} else {
			this.projectSettings = projectLoad.settings;
			this.projectLoadError = null;
		}
		this.rebuildEffectiveSettings();
	}

	reloadSection(section: "images" | "personalization"): void {
		const globalLoad = loadScope(this.storage, "global");
		if (!globalLoad.error) this.globalSettings[section] = globalLoad.settings[section];
		const projectLoad = loadScope(this.storage, "project");
		if (!projectLoad.error) this.projectSettings[section] = projectLoad.settings[section];
		this.rebuildEffectiveSettings();
	}

	readFreshGlobal<K extends keyof SettingsDocument>(key: K): SettingsDocument[K] {
		const load = loadScope(this.storage, "global");
		return load.error ? this.effectiveSettings[key] : load.settings[key];
	}

	async flush(): Promise<void> {
		await this.writeQueue;
	}

	drainErrors(): SettingsError[] {
		const drained = [...this.errors];
		this.errors = [];
		return drained;
	}

	private rebuildEffectiveSettings(): void {
		this.effectiveSettings = mergeSettings(this.globalSettings, this.projectSettings);
	}

	private enqueueWrite(scope: SettingsScope, snapshot: SettingsDocument, changes: SettingsChange[]): void {
		const savedSnapshot = structuredClone(snapshot);
		this.writeQueue = this.writeQueue
			.then(() => persistChanges(this.storage, scope, savedSnapshot, changes))
			.catch((error) => this.recordError(scope, error));
	}

	private recordError(scope: SettingsScope, error: unknown): void {
		this.errors.push({ scope, error: error instanceof Error ? error : new Error(String(error)) });
	}
}

function loadScope(storage: SettingsStoragePort, scope: SettingsScope): SettingsLoadResult {
	try {
		let content: string | undefined;
		storage.withLock(scope, (current) => {
			content = current;
			return undefined;
		});
		return { settings: content ? decodeSettingsDocument(content) : {}, error: null };
	} catch (error) {
		return { settings: {}, error: error instanceof Error ? error : new Error(String(error)) };
	}
}

function persistChanges(
	storage: SettingsStoragePort,
	scope: SettingsScope,
	snapshot: SettingsDocument,
	changes: SettingsChange[],
): void {
	storage.withLock(scope, (current) => {
		const persisted = current ? decodeSettingsDocument(current) : {};
		const merged = structuredClone(persisted);
		for (const change of changes) {
			const value = snapshot[change.field];
			if (change.nestedFields && isRecord(value)) {
				const persistedValue = persisted[change.field];
				const currentNested = isRecord(persistedValue) ? persistedValue : {};
				const nextNested = { ...currentNested };
				for (const nestedField of change.nestedFields) nextNested[nestedField] = value[nestedField];
				(merged as Record<string, unknown>)[change.field] = nextNested;
			} else {
				(merged as Record<string, unknown>)[change.field] = value;
			}
		}
		return JSON.stringify(merged, null, 2);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
