import type { RegisteredWorkspaceView } from "@shared/store/atoms";
import type { LoadedPlugin } from "../runtime/plugin-loader";

/**
 * Publish renderer-local plugin contributions into the host-owned workspace
 * registry. Keep both icon representations: `icon` is the theme-compatible
 * fallback, while `iconUrl` preserves full-color brand artwork.
 */
export function publishWorkspaceViews(plugins: readonly LoadedPlugin[]): RegisteredWorkspaceView[] {
	return plugins.flatMap((plugin) =>
		plugin.workspaceViews.map((view) => ({
			pluginId: plugin.id,
			pluginName: plugin.name,
			viewId: view.id,
			label: view.label,
			icon: view.icon,
			...(view.iconUrl ? { iconUrl: view.iconUrl } : {}),
			description: view.description,
			badge: view.badge,
			component: view.component,
			navOrder: view.navOrder ?? 0,
			sidebar: view.sidebar !== false,
		})),
	);
}
