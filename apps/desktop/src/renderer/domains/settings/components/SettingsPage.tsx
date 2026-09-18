import { PluginWorkspaceViewSurface } from "@domains/plugins/components/PluginWorkspaceViewRoute";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import type { JSX } from "react";
import { SettingsPageView } from "./SettingsPageView";
import { SettingsTabSurfaces } from "./SettingsTabSurfaces";
import { useSettingsPageModel } from "./useSettingsPageModel";
import "./settings-highlight.css";

export function SettingsPage(): JSX.Element {
	const model = useSettingsPageModel();
	const contentSurface = useThemeSurface("settings.pageContent");
	const activeTab = model.activeTab === "mcp" ? "general" : model.activeTab;
	const embedded = model.embeddedView;

	const content = embedded ? (
		<PluginWorkspaceViewSurface
			key={`${embedded.pluginId}:${embedded.viewId}`}
			pluginId={embedded.pluginId}
			viewId={embedded.viewId}
			onMissing={model.onCloseEmbeddedView}
		/>
	) : (
		<SettingsTabSurfaces activeTab={activeTab} />
	);

	return (
		<SettingsPageView
			content={content}
			contentSurfaceRootClassName={contentSurface?.rootClassName}
			fillContent={Boolean(embedded)}
			model={model}
		/>
	);
}
