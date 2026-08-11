import type { HostedRouteRef } from "@vetta/capability-sdk";

export const PLUGIN_HOSTED_ROUTE_PATH = "/workspace/$pluginId/$viewId";
export const THEME_HOSTED_ROUTE_PATH = "/theme/$themeId/$pageId";

export function pluginHostedRouteNavigationTarget(route: HostedRouteRef): {
	readonly to: typeof PLUGIN_HOSTED_ROUTE_PATH;
	readonly params: { readonly pluginId: string; readonly viewId: string };
} {
	return {
		to: PLUGIN_HOSTED_ROUTE_PATH,
		params: { pluginId: route.ownerId, viewId: route.pageId },
	};
}

export function themeHostedRouteNavigationTarget(route: HostedRouteRef): {
	readonly to: typeof THEME_HOSTED_ROUTE_PATH;
	readonly params: { readonly themeId: string; readonly pageId: string };
} {
	return {
		to: THEME_HOSTED_ROUTE_PATH,
		params: { themeId: route.ownerId, pageId: route.pageId },
	};
}

export function pluginHostedRoutePath(route: HostedRouteRef): string {
	return `/workspace/${encodeURIComponent(route.ownerId)}/${encodeURIComponent(route.pageId)}`;
}

export function themeHostedRoutePath(route: HostedRouteRef): string {
	return `/theme/${encodeURIComponent(route.ownerId)}/${encodeURIComponent(route.pageId)}`;
}
