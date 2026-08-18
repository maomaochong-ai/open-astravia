import { createCapabilityGrant, DOMAIN_NAVIGATION_CAPABILITIES } from "@vetta/capability-sdk";
import { describe, expect, it, vi } from "vitest";
import { RendererCapabilityHost } from "../capabilities/renderer-capability-host.js";
import { registerHostedRouteCapabilityProvider } from "./hosted-route-capability-provider.js";
import { HostedRouteService } from "./hosted-route-service.js";

describe("hosted route capability provider", () => {
	it("exposes the Desktop route service through an authorized capability session", async () => {
		const routes = new HostedRouteService();
		const open = vi.fn(async () => undefined);
		routes.registerNamespace("custom-pages", { path: () => "/custom", open });
		const host = new RendererCapabilityHost();
		registerHostedRouteCapabilityProvider(host, routes);
		const session = host.createSession({
			subject: { id: "test", sessionId: "test-session" },
			grants: [createCapabilityGrant(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE)],
		});
		const route = { namespace: "custom-pages", ownerId: "owner", pageId: "main" };

		await session.client.invoke(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE, route);

		expect(open).toHaveBeenCalledExactlyOnceWith(route, expect.any(AbortSignal));
	});
});
