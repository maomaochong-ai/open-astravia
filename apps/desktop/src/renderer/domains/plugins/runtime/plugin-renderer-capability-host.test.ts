import { RendererCapabilityHost } from "@shared/capabilities/renderer-capability-host";
import { registerHostedRouteCapabilityProvider } from "@shared/hosted-routes/hosted-route-capability-provider";
import { HostedRouteService } from "@shared/hosted-routes/hosted-route-service";
import { CAPABILITY_ERROR_CODES } from "@vetta/capability-sdk";
import { describe, expect, it, vi } from "vitest";
import { PLUGIN_RENDERER_ROUTE_NAMESPACE } from "./plugin-hosted-route-capability.js";
import { PluginRendererCapabilityHost } from "./plugin-renderer-capability-host.js";

describe("PluginRendererCapabilityHost", () => {
	it("runs official renderer operations only for active official sessions", () => {
		const host = new PluginRendererCapabilityHost();
		const operation = vi.fn(() => "ok");
		host.bindSession("official-session", {
			id: "official-plugin",
			enabled: true,
			trustLevel: "official",
		});

		expect(host.invokeOfficial("official-session", operation)).toBe("ok");
		expect(operation).toHaveBeenCalledOnce();

		host.closeSession("official-session");
		expect(() => host.invokeOfficial("official-session", operation)).toThrow(
			"Plugin renderer capability session is not active",
		);
	});

	it("denies community and disabled plugin sessions", () => {
		const host = new PluginRendererCapabilityHost();
		host.bindSession("community-session", {
			id: "community-plugin",
			enabled: true,
			trustLevel: "community",
		});
		host.bindSession("disabled-session", {
			id: "disabled-plugin",
			enabled: false,
			trustLevel: "official",
		});

		expect(() => host.invokeOfficial("community-session", () => {})).toThrow(
			"Plugin official renderer capability access denied",
		);
		expect(() => host.invokeOfficial("disabled-session", () => {})).toThrow(
			"Plugin official renderer capability access denied",
		);
	});

	it("revokes the previous renderer session when the same plugin is rebound", () => {
		const host = new PluginRendererCapabilityHost();
		const plugin = { id: "official-plugin", enabled: true, trustLevel: "official" as const };
		host.bindSession("first-session", plugin);
		host.bindSession("second-session", plugin);

		expect(() => host.invokeOfficial("first-session", () => {})).toThrow(
			"Plugin renderer capability session is not active",
		);
		expect(host.invokeOfficial("second-session", () => "ok")).toBe("ok");
	});

	it("grants hosted-route navigation only to enabled plugins with workspace-view permission", async () => {
		const capabilityHost = new RendererCapabilityHost();
		const routes = new HostedRouteService();
		const openRoute = vi.fn(async () => undefined);
		routes.registerNamespace(PLUGIN_RENDERER_ROUTE_NAMESPACE, {
			path: () => "/workspace/community-plugin/main",
			open: openRoute,
		});
		registerHostedRouteCapabilityProvider(capabilityHost, routes);
		const host = new PluginRendererCapabilityHost(capabilityHost);
		host.bindSession("allowed-session", {
			id: "community-plugin",
			enabled: true,
			trustLevel: "community",
			permissions: ["ui.slot.workspace-view"],
			grantedPermissions: ["ui.slot.workspace-view"],
		});
		host.bindSession("denied-session", {
			id: "no-workspace-plugin",
			enabled: true,
			trustLevel: "official",
			permissions: [],
			grantedPermissions: [],
		});
		host.bindSession("disabled-session", {
			id: "disabled-plugin",
			enabled: false,
			trustLevel: "community",
			permissions: ["ui.slot.workspace-view"],
			grantedPermissions: ["ui.slot.workspace-view"],
		});
		const route = {
			namespace: PLUGIN_RENDERER_ROUTE_NAMESPACE,
			ownerId: "community-plugin",
			pageId: "main",
		} as const;

		await host.openWorkspaceView("allowed-session", "main");

		expect(openRoute).toHaveBeenCalledExactlyOnceWith(route, expect.any(AbortSignal));
		await expect(host.openWorkspaceView("denied-session", "main")).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.ACCESS_DENIED,
		});
		await expect(host.openWorkspaceView("disabled-session", "main")).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.ACCESS_DENIED,
		});
	});
});
