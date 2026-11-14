// @vitest-environment jsdom

import type { InstalledPlugin } from "@preload/api";
import type { PluginPermission } from "@astravia-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "./plugin-context";
import { PluginLocalContributions } from "./plugin-local-contributions";

function installedPlugin(grantedPermissions: PluginPermission[]): InstalledPlugin {
	return {
		id: "open-in-app",
		name: "Open in app",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^2.10.0",
		entryUrl: "astravia-plugin://open-in-app/dist/mf-manifest.json",
		moduleFederation: { remoteName: "open_in_app", expose: "./plugin" },
		styleUrls: [],
		permissions: ["shell.open-external-app", "ui.slot.header-action"],
		grantedPermissions,
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "en",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-11-14T00:00:00Z",
		updatedAt: "2026-11-14T00:00:00Z",
		source: "remote",
		trustLevel: "community",
		rootPath: "/plugins/open-in-app",
	};
}

function createContext(permissions: PluginPermission[]) {
	const contributions = new PluginLocalContributions();
	const ctx = createPluginContext({
		plugin: installedPlugin(permissions),
		contributions,
		secretsApi: {
			get: async () => undefined,
			has: async () => false,
			keys: async () => [],
			set: async () => {},
			delete: async () => {},
			onChange: () => ({ dispose: () => {} }),
		},
		onChanged: () => {},
		disposers: [],
		pendingRuntimeRegistrations: [],
		activationId: "test-activation",
		capabilitySessionId: "capability-1",
	});
	return ctx;
}

const listExternalApplications = vi.fn(async () => []);

beforeEach(() => {
	vi.unstubAllGlobals();
	listExternalApplications.mockClear();
	vi.stubGlobal("astravia", {
		plugins: { listExternalApplications, internalCapabilities: { filesystem: {}, storage: {} } },
	});
});

describe("ctx.shell", () => {
	it("goes through the capability session so the main process can re-check the permission", async () => {
		const ctx = createContext(["shell.open-external-app"]);
		await ctx.shell.listExternalApplications("/work/demo");
		expect(listExternalApplications).toHaveBeenCalledWith("capability-1", "/work/demo");
	});

	it("refuses to call the host without the permission", async () => {
		const ctx = createContext([]);
		await expect(ctx.shell.listExternalApplications("/work/demo")).rejects.toThrow();
		expect(listExternalApplications).not.toHaveBeenCalled();
	});

	it("rejects an empty target path and an unknown application kind before reaching the host", async () => {
		const ctx = createContext(["shell.open-external-app"]);
		await expect(ctx.shell.listExternalApplications("")).rejects.toThrow();
		await expect(ctx.shell.openPathWithApplication("/work", "  ", "editor")).rejects.toThrow();
		await expect(ctx.shell.openPathWithApplication("/work", "code", "bogus" as never)).rejects.toThrow();
		expect(listExternalApplications).not.toHaveBeenCalled();
	});

	it("allows a null target so a plugin can just launch the app", async () => {
		const ctx = createContext(["shell.open-external-app"]);
		await ctx.shell.listExternalApplications(null);
		expect(listExternalApplications).toHaveBeenCalledWith("capability-1", null);
	});
});
