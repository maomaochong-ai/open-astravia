import type { Disposable, HostedRouteRef } from "@vetta/capability-sdk";
import { PLUGIN_RENDERER_ROUTE_NAMESPACE } from "./domains/plugins/runtime/plugin-hosted-route-capability.js";
import { router } from "./router.js";
import { rendererCapabilityHost } from "./shared/capabilities/renderer-capability-host.js";
import { registerHostedRouteCapabilityProvider } from "./shared/hosted-routes/hosted-route-capability-provider.js";
import {
	PLUGIN_HOSTED_ROUTE_PATH,
	pluginHostedRouteNavigationTarget,
	pluginHostedRoutePath,
	THEME_HOSTED_ROUTE_PATH,
	themeHostedRouteNavigationTarget,
	themeHostedRoutePath,
} from "./shared/hosted-routes/hosted-route-descriptors.js";
import {
	desktopHostedRouteService,
	type HostedRouteNamespaceAdapter,
} from "./shared/hosted-routes/hosted-route-service.js";
import { THEME_RENDERER_ROUTE_NAMESPACE } from "./shared/theme/pages/theme-hosted-route-capability.js";

let registrations: readonly Disposable[] | undefined;

function createPluginRouterAdapter(): HostedRouteNamespaceAdapter {
	return {
		path: pluginHostedRoutePath,
		open: async (route: HostedRouteRef) => {
			const target = pluginHostedRouteNavigationTarget(route);
			await router.navigate({ to: PLUGIN_HOSTED_ROUTE_PATH, params: target.params });
		},
	};
}

function createThemeRouterAdapter(): HostedRouteNamespaceAdapter {
	return {
		path: themeHostedRoutePath,
		open: async (route: HostedRouteRef) => {
			const target = themeHostedRouteNavigationTarget(route);
			await router.navigate({ to: THEME_HOSTED_ROUTE_PATH, params: target.params });
		},
	};
}

export function initializeHostedRoutes(): void {
	if (registrations) return;
	const next: Disposable[] = [];
	try {
		next.push(
			desktopHostedRouteService.registerNamespace(PLUGIN_RENDERER_ROUTE_NAMESPACE, createPluginRouterAdapter()),
			desktopHostedRouteService.registerNamespace(THEME_RENDERER_ROUTE_NAMESPACE, createThemeRouterAdapter()),
			registerHostedRouteCapabilityProvider(rendererCapabilityHost, desktopHostedRouteService),
		);
		registrations = next;
	} catch (error) {
		for (const registration of next.reverse()) registration.dispose();
		throw error;
	}
}
