import { RendererCapabilityHost } from "@shared/capabilities/renderer-capability-host";
import { registerHostedRouteCapabilityProvider } from "@shared/hosted-routes/hosted-route-capability-provider";
import { HostedRouteService } from "@shared/hosted-routes/hosted-route-service";
import { describe, expect, it, vi } from "vitest";
import { THEME_RENDERER_ROUTE_NAMESPACE } from "./theme-hosted-route-capability.js";
import { ThemeRendererCapabilityHost } from "./theme-renderer-capability-host.js";

describe("ThemeRendererCapabilityHost", () => {
	it("opens only routes owned by the active theme capability session", async () => {
		const capabilityHost = new RendererCapabilityHost();
		const routes = new HostedRouteService();
		const openRoute = vi.fn(async () => undefined);
		routes.registerNamespace(THEME_RENDERER_ROUTE_NAMESPACE, {
			path: () => "/theme/theme.example/settings",
			open: openRoute,
		});
		registerHostedRouteCapabilityProvider(capabilityHost, routes);
		const host = new ThemeRendererCapabilityHost(capabilityHost);
		const activation = host.activate("theme.example");

		await host.openPage("theme.example", "settings");

		expect(openRoute).toHaveBeenCalledExactlyOnceWith(
			{
				namespace: THEME_RENDERER_ROUTE_NAMESPACE,
				ownerId: "theme.example",
				pageId: "settings",
			},
			expect.any(AbortSignal),
		);
		await expect(host.openPage("other-theme", "settings")).rejects.toThrow(
			"Theme renderer capability session is not active",
		);

		activation.dispose();
		await expect(host.openPage("theme.example", "settings")).rejects.toThrow(
			"Theme renderer capability session is not active",
		);
	});

	it("revokes the previous capability session when the active theme changes", async () => {
		const capabilityHost = new RendererCapabilityHost();
		const routes = new HostedRouteService();
		const openRoute = vi.fn(async () => undefined);
		routes.registerNamespace(THEME_RENDERER_ROUTE_NAMESPACE, {
			path: () => "/theme",
			open: openRoute,
		});
		registerHostedRouteCapabilityProvider(capabilityHost, routes);
		const host = new ThemeRendererCapabilityHost(capabilityHost);
		const previous = host.activate("theme.previous");
		const current = host.activate("theme.current");

		previous.dispose();
		await host.openPage("theme.current", "home");
		await expect(host.openPage("theme.previous", "home")).rejects.toThrow(
			"Theme renderer capability session is not active",
		);

		current.dispose();
		await expect(host.openPage("theme.current", "home")).rejects.toThrow(
			"Theme renderer capability session is not active",
		);
	});
});
