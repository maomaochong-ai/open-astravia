import type { SettingsTab } from "@shared/store/atoms";
import type { ComponentType } from "react";

type SettingsTabLoader = () => Promise<{ default: ComponentType }>;

/** The same imports serve both React.lazy and intent prefetch. */
export const SETTINGS_TAB_LOADERS = {
	account: async () => ({ default: (await import("./AccountSettings")).AccountSettings }),
	context: async () => ({ default: (await import("./AgentSettings")).AgentSettings }),
	appearance: async () => ({ default: (await import("./AppearanceSettings")).AppearanceSettings }),
	appshot: async () => ({ default: (await import("./AppshotSettings")).AppshotSettings }),
	archive: async () => ({ default: (await import("./ArchivedProjectsSettings")).ArchivedProjectsSettings }),
	extensions: async () => ({ default: (await import("./ExtensionsSettings")).ExtensionsSettings }),
	environment: async () => ({ default: (await import("./EnvironmentSettings")).EnvironmentSettings }),
	general: async () => ({ default: (await import("./GeneralSettings")).GeneralSettings }),
	im: async () => ({ default: (await import("./ImBridgeSettings")).ImBridgeSettings }),
	knowledge: async () => ({ default: (await import("./KnowledgeBaseSettings")).KnowledgeBaseSettings }),
	models: async () => ({ default: (await import("./ModelsSettings")).ModelsSettings }),
	permissions: async () => ({ default: (await import("./PermissionsSettings")).PermissionsSettings }),
	remote: async () => ({ default: (await import("./RemotePairingSettings")).RemotePairingSettings }),
	pet: async () => ({ default: (await import("./PetSettings")).PetSettings }),
	shortcuts: async () => ({ default: (await import("./ShortcutsSettings")).ShortcutsSettings }),
	team: async () => ({ default: (await import("./TeamSettings")).TeamSettings }),
	webhook: async () => ({ default: (await import("./WebhookSettings")).WebhookSettings }),
} satisfies Record<Exclude<SettingsTab, "mcp">, SettingsTabLoader>;

export function prefetchSettingsTab(tab: string): void {
	const load = (SETTINGS_TAB_LOADERS as Record<string, SettingsTabLoader>)[tab];
	if (!load) return;
	void load().catch(() => {
		// React.lazy still handles navigation errors; prefetch remains optional.
	});
}
