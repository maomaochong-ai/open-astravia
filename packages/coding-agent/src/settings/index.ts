import type { SettingsRuntime as SettingsRuntimeContract } from "./contracts/settings-runtime.js";
import {
	createFileSettingsRuntime,
	createInMemorySettingsRuntime,
	createSettingsRuntimeFromStorage,
} from "./runtime/create-settings-runtime.js";

export type { HostSettingsPort } from "./contracts/host-settings.js";
export type { ModelSettingsPort } from "./contracts/model-settings.js";
export type { ResourceSettingsPort } from "./contracts/resource-settings.js";
export type {
	ResolvedCompactionSettings,
	ResolvedRetrySettings,
	SessionSettingsPort,
} from "./contracts/session-settings.js";
export type {
	BranchSummarySettings,
	CompactionSettings,
	ImageSettings,
	MarkdownSettings,
	PackageSource,
	PersonalizationSettings,
	RetrySettings,
	SettingsDocument,
	SettingsScope,
	TerminalSettings,
	ThinkingBudgetsSettings,
	TransportSetting,
} from "./contracts/settings-document.js";
export type { SettingsError, SettingsLifecyclePort } from "./contracts/settings-lifecycle.js";
export type { SettingsStoragePort } from "./contracts/settings-storage.js";
export { FileSettingsStorage } from "./storage/file-settings-storage.js";
export { MemorySettingsStorage } from "./storage/memory-settings-storage.js";

export type SettingsRuntime = SettingsRuntimeContract;

export const SettingsRuntime = {
	create: createFileSettingsRuntime,
	fromStorage: createSettingsRuntimeFromStorage,
	inMemory: createInMemorySettingsRuntime,
} as const;

export { createFileSettingsRuntime, createInMemorySettingsRuntime, createSettingsRuntimeFromStorage };
