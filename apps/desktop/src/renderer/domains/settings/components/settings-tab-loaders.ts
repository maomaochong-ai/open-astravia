import type { SettingsTab } from "@shared/store/atoms";
import type { ComponentType } from "react";

export type SettingsContentTab = Exclude<SettingsTab, "mcp">;

function memoizeLoader<T>(load: () => Promise<T>): () => Promise<T> {
	let promise: Promise<T> | null = null;
	return () => {
		promise ??= load();
		return promise;
	};
}

type TabModule = { default: ComponentType };

export const SETTINGS_TAB_LOADERS: Record<SettingsContentTab, () => Promise<TabModule>> = {
	account: memoizeLoader(() => import("./AccountSettings").then((module) => ({ default: module.AccountSettings }))),
	appearance: memoizeLoader(() =>
		import("./AppearanceSettings").then((module) => ({ default: module.AppearanceSettings })),
	),
	appshot: memoizeLoader(() => import("./AppshotSettings").then((module) => ({ default: module.AppshotSettings }))),
	archive: memoizeLoader(() =>
		import("./ArchivedProjectsSettings").then((module) => ({ default: module.ArchivedProjectsSettings })),
	),
	context: memoizeLoader(() => import("./AgentSettings").then((module) => ({ default: module.AgentSettings }))),
	environment: memoizeLoader(() =>
		import("./EnvironmentSettings").then((module) => ({ default: module.EnvironmentSettings })),
	),
	extensions: memoizeLoader(() =>
		import("./ExtensionsSettings").then((module) => ({ default: module.ExtensionsSettings })),
	),
	general: memoizeLoader(() => import("./GeneralSettings").then((module) => ({ default: module.GeneralSettings }))),
	im: memoizeLoader(() => import("./ImBridgeSettings").then((module) => ({ default: module.ImBridgeSettings }))),
	knowledge: memoizeLoader(() =>
		import("./KnowledgeBaseSettings").then((module) => ({ default: module.KnowledgeBaseSettings })),
	),
	models: memoizeLoader(() => import("./ModelsSettings").then((module) => ({ default: module.ModelsSettings }))),
	permissions: memoizeLoader(() =>
		import("./PermissionsSettings").then((module) => ({ default: module.PermissionsSettings })),
	),
	pet: memoizeLoader(() => import("./PetSettings").then((module) => ({ default: module.PetSettings }))),
	remote: memoizeLoader(() =>
		import("./RemotePairingSettings").then((module) => ({ default: module.RemotePairingSettings })),
	),
	shortcuts: memoizeLoader(() =>
		import("./ShortcutsSettings").then((module) => ({ default: module.ShortcutsSettings })),
	),
	team: memoizeLoader(() => import("./TeamSettings").then((module) => ({ default: module.TeamSettings }))),
	webhook: memoizeLoader(() => import("./WebhookSettings").then((module) => ({ default: module.WebhookSettings }))),
};

export function prefetchSettingsTab(tab: string): void {
	const key = tab === "mcp" ? "general" : tab;
	const loader = SETTINGS_TAB_LOADERS[key as SettingsContentTab];
	if (loader) void loader().catch(() => undefined);
}
