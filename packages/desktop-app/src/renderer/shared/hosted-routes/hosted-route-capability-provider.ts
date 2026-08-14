import { bindCapability } from "@vetta/capability-runtime";
import { type Disposable, DOMAIN_NAVIGATION_CAPABILITIES } from "@vetta/capability-sdk";
import type { RendererCapabilityHost } from "../capabilities/renderer-capability-host.js";
import type { HostedRouteService } from "./hosted-route-service.js";

const HOSTED_ROUTE_PROVIDER_OWNER = "desktop-renderer:hosted-route-navigation";

export function registerHostedRouteCapabilityProvider(
	host: RendererCapabilityHost,
	routes: HostedRouteService,
): Disposable {
	return host.registerDomainProviders(HOSTED_ROUTE_PROVIDER_OWNER, [
		bindCapability(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE, {
			execute: async (route, context) => {
				await routes.open(route, context.signal);
			},
		}),
	]);
}
