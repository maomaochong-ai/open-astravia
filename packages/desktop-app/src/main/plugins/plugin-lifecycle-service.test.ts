import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { PluginLifecycleService } from "./plugin-lifecycle-service.js";

function installedPlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.0.0",
		runtime: "esm",
		entryUrl: "vetta-plugin://demo/index.js",
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		allowedNetworkHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "zh",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "archive",
		trustLevel: "local",
		rootPath: "C:/plugins/demo",
		...overrides,
	};
}

function createHarness(plugin = installedPlugin()) {
	const events: string[] = [];
	let current = plugin;
	const actions = { clear: vi.fn(() => events.push("clear-actions")) };
	const dependencies = {
		listPlugins: () => [current],
		readAgentMode: async () => "work",
		installFromArchive: async () => current,
		installFromUrl: async () => current,
		installFromPath: async () => current,
		uninstall: vi.fn(() => events.push("uninstall")),
		setEnabled: vi.fn((_id: string, enabled: boolean) => {
			events.push(`set-enabled:${enabled}`);
			current = { ...current, enabled };
			return current;
		}),
		grantPermissions: vi.fn((_id: string, permissions: InstalledPlugin["grantedPermissions"]) => {
			current = { ...current, grantedPermissions: [...permissions] };
			return current;
		}),
		revokePermissions: vi.fn(() => current),
		grantCommands: vi.fn(() => current),
		revokeCommands: vi.fn(() => current),
		reload: vi.fn(() => current),
		stopDevWatch: vi.fn(() => events.push("stop-watch")),
		stopSpawns: vi.fn(() => events.push("stop-spawns")),
		destroyOffscreenSessions: vi.fn(() => events.push("destroy-offscreen")),
		refreshRuntime: vi.fn(() => events.push("refresh-runtime")),
		recordEvent: vi.fn(() => events.push("record-event")),
	};
	return { service: new PluginLifecycleService(actions, dependencies), dependencies, actions, events };
}

describe("PluginLifecycleService", () => {
	it("refreshes the agent runtime after installing an archive", async () => {
		const harness = createHarness();

		await harness.service.installArchive(new ArrayBuffer(0));
		expect(harness.events).toEqual(["record-event", "refresh-runtime"]);
	});

	it("owns the complete disable lifecycle", () => {
		const harness = createHarness();

		expect(harness.service.setEnabled("demo", false).enabled).toBe(false);
		expect(harness.events).toEqual([
			"stop-watch",
			"stop-spawns",
			"destroy-offscreen",
			"set-enabled:false",
			"clear-actions",
			"refresh-runtime",
			"record-event",
		]);
	});

	it("owns uninstall cleanup before deleting the plugin record", () => {
		const harness = createHarness();

		harness.service.uninstall("demo");
		expect(harness.events).toEqual([
			"stop-watch",
			"stop-spawns",
			"destroy-offscreen",
			"uninstall",
			"clear-actions",
			"refresh-runtime",
			"record-event",
		]);
	});

	it("records only newly granted permissions", () => {
		const harness = createHarness(installedPlugin({ grantedPermissions: ["agent.skills.control"] }));

		harness.service.grantPermissions("demo", ["agent.skills.control", "agent.tools.register"]);
		expect(harness.dependencies.recordEvent).toHaveBeenCalledWith(
			expect.objectContaining({ operation: "permissions-granted", permissionCount: 1 }),
		);
	});
});
