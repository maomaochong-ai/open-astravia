import { CODING_IMAGE_CONFIGURATION_ID } from "@vetta/runtime-tools";
import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api.js";
import {
	DesktopRuntimeConfigurationService,
	type DesktopRuntimeConfigurationServiceDependencies,
} from "./runtime-configuration-service.js";

function plugin(): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		description: "Demo settings",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.0.0",
		moduleFederation: { remoteName: "runtime_configuration_test", expose: "./plugin" },
		entryUrl: "vetta-plugin://demo/index.js",
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "en",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "archive",
		trustLevel: "local",
		rootPath: "C:/plugins/demo",
		settingsSchema: [
			{ key: "mode", type: "enum", title: "Mode", enum: ["fast", "safe"], default: "safe" },
			{ key: "token", type: "secret", title: "Token" },
		],
	};
}

function createHarness() {
	let agentSettings: Record<string, unknown> = {};
	let pluginValues: Record<string, unknown> = { mode: "fast", token: "top-secret" };
	let plugins = [plugin()];
	const logger = { info: vi.fn(), warn: vi.fn() };
	const publishPluginSettingsChanged = vi.fn();
	const dependencies: DesktopRuntimeConfigurationServiceDependencies = {
		readAgentSettings: () => agentSettings,
		updateAgentSettings: (mutate) => {
			agentSettings = structuredClone(agentSettings);
			mutate(agentSettings);
		},
		listPlugins: () => plugins,
		getPluginSettings: () => pluginValues,
		setPluginSettings: (_pluginId, values) => {
			pluginValues = values;
			return values;
		},
		publishPluginSettingsChanged,
		readConfiguredTools: () => [
			{
				pluginId: "demo",
				tools: [{ name: "demo_tool", settingKeys: ["mode"], support: "adapter" }],
			},
		],
		logger,
	};
	return {
		service: new DesktopRuntimeConfigurationService(dependencies),
		logger,
		publishPluginSettingsChanged,
		readAgentSettings: () => agentSettings,
		readPluginValues: () => pluginValues,
		removePlugins: () => {
			plugins = [];
		},
	};
}

describe("DesktopRuntimeConfigurationService", () => {
	it("aggregates built-in and plugin definitions without exposing secret values", async () => {
		const harness = createHarness();
		const catalog = await harness.service.list();

		expect(catalog.entries.map(({ configurationId }) => configurationId)).toEqual([
			CODING_IMAGE_CONFIGURATION_ID,
			"plugin.demo.settings",
		]);
		const pluginEntry = catalog.entries.find(({ configurationId }) => configurationId === "plugin.demo.settings");
		expect(pluginEntry?.value).toEqual({ mode: "fast" });
		expect(pluginEntry?.redactedPaths).toContain("/token");
		expect(pluginEntry?.configuredSensitivePaths).toEqual(["/token"]);
		expect(JSON.stringify(catalog)).not.toContain("top-secret");
		expect(pluginEntry?.consumers).toContainEqual({
			kind: "tool",
			id: "demo_tool",
			settingKeys: ["mode"],
			support: "adapter",
		});
		await harness.service.close();
	});

	it("validates and persists nested image patches as a complete configuration", async () => {
		const harness = createHarness();
		await harness.service.set(CODING_IMAGE_CONFIGURATION_ID, { resize: { maxWidth: 640 } });

		const images = harness.readAgentSettings().images as Record<string, unknown>;
		expect((images.resize as Record<string, unknown>).maxWidth).toBe(640);
		expect((images.resize as Record<string, unknown>).maxHeight).toBe(1280);
		expect(harness.logger.info).toHaveBeenCalledWith("runtime configuration updated", {
			configurationId: CODING_IMAGE_CONFIGURATION_ID,
		});
		expect(JSON.stringify(harness.logger.info.mock.calls)).not.toContain("640");
		await expect(
			harness.service.set(CODING_IMAGE_CONFIGURATION_ID, { requestBudget: { lowWatermarkBytes: 20_000_000 } }),
		).rejects.toThrow("low watermark");
		await harness.service.close();
	});

	it("preserves plugin secrets on partial updates and retires removed definitions", async () => {
		const harness = createHarness();
		await harness.service.set("plugin.demo.settings", { mode: "safe" });
		expect(harness.readPluginValues()).toEqual({ mode: "safe", token: "top-secret" });
		expect(harness.publishPluginSettingsChanged).toHaveBeenCalledWith("demo", {
			mode: "safe",
			token: "top-secret",
		});

		harness.removePlugins();
		const catalog = await harness.service.list();
		expect(catalog.entries.some(({ configurationId }) => configurationId === "plugin.demo.settings")).toBe(false);
		await harness.service.close();
	});

	it("publishes a complete secret after one configuration update without exposing it in the catalog", async () => {
		const harness = createHarness();
		const catalog = await harness.service.set("plugin.demo.settings", { token: "complete-password" });

		expect(harness.readPluginValues()).toEqual({ mode: "fast", token: "complete-password" });
		expect(harness.publishPluginSettingsChanged).toHaveBeenCalledWith("demo", {
			mode: "fast",
			token: "complete-password",
		});
		const pluginEntry = catalog.entries.find(({ configurationId }) => configurationId === "plugin.demo.settings");
		expect(pluginEntry?.configuredSensitivePaths).toEqual(["/token"]);
		expect(JSON.stringify(catalog)).not.toContain("complete-password");
		await harness.service.close();
	});
});
