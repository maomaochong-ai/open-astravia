import type { InstalledPlugin } from "@preload/api";
import type {
	PluginActivityTabContribution,
	PluginCardRendererContribution,
	PluginFileExplorerContextMenuContribution,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerToolbarContribution,
	PluginFilePreviewContribution,
	PluginGlobalSlotContribution,
	PluginInputActionContribution,
	PluginLocales,
	PluginToolCallSlotContribution,
	PluginTurnCardContribution,
	PluginWorkspaceViewContribution,
} from "@vetta-org/plugin-sdk";

export interface LoadedPlugin {
	id: string;
	name: string;
	version: string;
	defaultLocale: string;
	locales: PluginLocales;
	slots: PluginGlobalSlotContribution[];
	filePreviews: PluginFilePreviewContribution[];
	fileExplorerContextMenuActions: PluginFileExplorerContextMenuContribution[];
	fileExplorerToolbarActions: PluginFileExplorerToolbarContribution[];
	fileExplorerDecorationProviders: PluginFileExplorerDecorationProvider[];
	activityTabs: PluginActivityTabContribution[];
	inputActions: PluginInputActionContribution[];
	cardRenderers: PluginCardRendererContribution[];
	toolCallSlots: PluginToolCallSlotContribution[];
	turnCards: PluginTurnCardContribution[];
	workspaceViews: PluginWorkspaceViewContribution[];
	dispose(): Promise<void>;
}

export class PluginLocalContributions {
	readonly slots: PluginGlobalSlotContribution[] = [];
	readonly filePreviews: PluginFilePreviewContribution[] = [];
	readonly fileExplorerContextMenuActions: PluginFileExplorerContextMenuContribution[] = [];
	readonly fileExplorerToolbarActions: PluginFileExplorerToolbarContribution[] = [];
	readonly fileExplorerDecorationProviders: PluginFileExplorerDecorationProvider[] = [];
	readonly activityTabs: PluginActivityTabContribution[] = [];
	readonly inputActions: PluginInputActionContribution[] = [];
	readonly cardRenderers: PluginCardRendererContribution[] = [];
	readonly toolCallSlots: PluginToolCallSlotContribution[] = [];
	readonly turnCards: PluginTurnCardContribution[] = [];
	readonly workspaceViews: PluginWorkspaceViewContribution[] = [];

	clear(): void {
		this.slots.length = 0;
		this.filePreviews.length = 0;
		this.fileExplorerContextMenuActions.length = 0;
		this.fileExplorerToolbarActions.length = 0;
		this.fileExplorerDecorationProviders.length = 0;
		this.activityTabs.length = 0;
		this.inputActions.length = 0;
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
			filePreviews: this.filePreviews,
			fileExplorerContextMenuActions: this.fileExplorerContextMenuActions,
			fileExplorerToolbarActions: this.fileExplorerToolbarActions,
			fileExplorerDecorationProviders: this.fileExplorerDecorationProviders,
			activityTabs: this.activityTabs,
			inputActions: this.inputActions,
			cardRenderers: this.cardRenderers,
			toolCallSlots: this.toolCallSlots,
			turnCards: this.turnCards,
			workspaceViews: this.workspaceViews,
			dispose,
		};
	}
}
