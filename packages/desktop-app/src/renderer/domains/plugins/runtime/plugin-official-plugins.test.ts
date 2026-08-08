import type { InstalledPlugin } from "@preload/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialPluginsApi } from "./plugin-official-plugins.js";

function createInstalledPlugin(id = "target"): InstalledPlugin {
	return {
		id,
		name: "Target",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "1",
		runtime: "esm",
		entryUrl: "file:///target/index.js",
		styleUrls: [],
		permissions: ["network.fetch"],
		grantedPermissions: ["network.fetch"],
		allowedNetworkHosts: ["example.com"],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "zh",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "system",
		trustLevel: "official",
		rootPath: "C:/plugins/target",
	};
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialPluginsApi", () => {
	it("routes plugin system operations through the official capability session", async () => {
		const plugin = createInstalledPlugin();
		const pluginSystem = {
			list: vi.fn().mockResolvedValue([plugin]),
			installFromUrl: vi.fn().mockResolvedValue(plugin),
			installFromPath: vi.fn().mockResolvedValue(plugin),
			uninstall: vi.fn().mockResolvedValue(undefined),
			setEnabled: vi.fn().mockResolvedValue(plugin),
			reload: vi.fn().mockResolvedValue(plugin),
		};
		const startDevWatch = vi.fn().mockResolvedValue(plugin);
		const stopDevWatch = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { pluginSystem }, startDevWatch, stopDevWatch } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialPluginsApi(assertOfficial, "capability-session");

		await expect(api.list()).resolves.toHaveLength(1);
		await expect(api.get("target")).resolves.toHaveProperty("id", "target");
		await expect(api.setEnabled("target", false)).resolves.toHaveProperty("id", "target");
		await expect(api.installFromUrl("https://example.com/plugin.zip")).resolves.toHaveProperty("id", "target");
		await expect(
			api.installFromPath("C:/plugin.zip", { grantedPermissions: ["network.fetch"], enable: true }),
		).resolves.toHaveProperty("id", "target");
		await expect(api.uninstall("target")).resolves.toBeUndefined();
		await expect(api.reload("target")).resolves.toHaveProperty("id", "target");
		await expect(api.startDevWatch("target", "C:/plugin-project")).resolves.toHaveProperty("id", "target");
		await expect(api.stopDevWatch("target")).resolves.toBeUndefined();

		expect(assertOfficial).toHaveBeenCalledTimes(9);
		expect(pluginSystem.list).toHaveBeenCalledTimes(2);
		expect(pluginSystem.list).toHaveBeenCalledWith("capability-session");
		expect(pluginSystem.setEnabled).toHaveBeenCalledWith("capability-session", "target", false);
		expect(pluginSystem.installFromUrl).toHaveBeenCalledWith("capability-session", "https://example.com/plugin.zip");
		expect(pluginSystem.installFromPath).toHaveBeenCalledWith("capability-session", "C:/plugin.zip", {
			grantedPermissions: ["network.fetch"],
			enable: true,
		});
		expect(pluginSystem.uninstall).toHaveBeenCalledWith("capability-session", "target");
		expect(pluginSystem.reload).toHaveBeenCalledWith("capability-session", "target");
		expect(startDevWatch).toHaveBeenCalledWith("capability-session", "target", "C:/plugin-project");
		expect(stopDevWatch).toHaveBeenCalledWith("capability-session", "target");
	});
});
