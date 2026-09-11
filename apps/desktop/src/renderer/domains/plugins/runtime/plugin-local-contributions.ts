import type { InstalledPlugin } from "@preload/api";
import type {
	PluginAbilityDetailSlotContribution,
	PluginActivityTabContribution,
	PluginCardRendererContribution,
	PluginFileExplorerContextMenuContribution,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerToolbarContribution,
	PluginFilePreviewContribution,
	PluginGlobalSlotContribution,
	PluginInputActionContribution,
	PluginLocales,
	PluginNewSessionContextContribution,
	PluginToolCallSlotContribution,
	PluginTurnCardContribution,
	PluginWorkspaceViewContribution,
} from "@vetta-org/plugin-sdk";

/**
 * 宿主侧补全的上下文区贡献：`canReadDraft` 在注册时按插件权限定下来。
 *
 * 权限只有注册这一刻能看到插件记录，发布环节拿不到，所以在这里钉死而不是每帧再查。
 */
export type ResolvedPluginNewSessionContextContribution = PluginNewSessionContextContribution & {
	canReadDraft: boolean;
};

/** Host-normalized workspace view with a resolved full-color image source. */
export type ResolvedPluginWorkspaceViewContribution = PluginWorkspaceViewContribution & {
	iconUrl?: string;
};

export interface LoadedPlugin {
	id: string;
	name: string;
	version: string;
	defaultLocale: string;
	locales: PluginLocales;
	slots: PluginGlobalSlotContribution[];
	abilityDetailSlots: PluginAbilityDetailSlotContribution[];
	filePreviews: PluginFilePreviewContribution[];
	fileExplorerContextMenuActions: PluginFileExplorerContextMenuContribution[];
	fileExplorerToolbarActions: PluginFileExplorerToolbarContribution[];
	fileExplorerDecorationProviders: PluginFileExplorerDecorationProvider[];
	activityTabs: PluginActivityTabContribution[];
	inputActions: PluginInputActionContribution[];
	newSessionContexts: ResolvedPluginNewSessionContextContribution[];
	cardRenderers: PluginCardRendererContribution[];
	toolCallSlots: PluginToolCallSlotContribution[];
	turnCards: PluginTurnCardContribution[];
	workspaceViews: ResolvedPluginWorkspaceViewContribution[];
	dispose(): Promise<void>;
}

export class PluginLocalContributions {
	readonly slots: PluginGlobalSlotContribution[] = [];
	readonly abilityDetailSlots: PluginAbilityDetailSlotContribution[] = [];
	readonly filePreviews: PluginFilePreviewContribution[] = [];
	readonly fileExplorerContextMenuActions: PluginFileExplorerContextMenuContribution[] = [];
	readonly fileExplorerToolbarActions: PluginFileExplorerToolbarContribution[] = [];
	readonly fileExplorerDecorationProviders: PluginFileExplorerDecorationProvider[] = [];
	readonly activityTabs: PluginActivityTabContribution[] = [];
	readonly inputActions: PluginInputActionContribution[] = [];
	readonly newSessionContexts: ResolvedPluginNewSessionContextContribution[] = [];
	readonly cardRenderers: PluginCardRendererContribution[] = [];
	readonly toolCallSlots: PluginToolCallSlotContribution[] = [];
	readonly turnCards: PluginTurnCardContribution[] = [];
	readonly workspaceViews: ResolvedPluginWorkspaceViewContribution[] = [];

	clear(): void {
		this.slots.length = 0;
		this.abilityDetailSlots.length = 0;
		this.filePreviews.length = 0;
		this.fileExplorerContextMenuActions.length = 0;
		this.fileExplorerToolbarActions.length = 0;
		this.fileExplorerDecorationProviders.length = 0;
		this.activityTabs.length = 0;
		this.inputActions.length = 0;
		this.newSessionContexts.length = 0;
		this.cardRenderers.length = 0;
		this.toolCallSlots.length = 0;
		this.turnCards.length = 0;
		this.workspaceViews.length = 0;
	}

	toLoadedPlugin(plugin: InstalledPlugin, dispose: () => Promise<void>): LoadedPlugin {
		return {
			id: plugin.id,
			name: plugin.name,
			version: plugin.activeVersion,
			defaultLocale: plugin.defaultLocale,
			locales: plugin.locales,
			slots: this.slots,
			abilityDetailSlots: this.abilityDetailSlots,
			filePreviews: this.filePreviews,
			fileExplorerContextMenuActions: this.fileExplorerContextMenuActions,
			fileExplorerToolbarActions: this.fileExplorerToolbarActions,
			fileExplorerDecorationProviders: this.fileExplorerDecorationProviders,
			activityTabs: this.activityTabs,
			inputActions: this.inputActions,
			newSessionContexts: this.newSessionContexts,
			cardRenderers: this.cardRenderers,
			toolCallSlots: this.toolCallSlots,
			turnCards: this.turnCards,
			workspaceViews: this.workspaceViews,
			dispose,
		};
	}
}
