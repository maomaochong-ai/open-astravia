// @vitest-environment jsdom

import type { InstalledPlugin } from "@preload/api";
import type { PluginPermission } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginSnapshot } from "../components/plugin-snapshot";
import { createPluginContext } from "./plugin-context";
import { PluginLocalContributions } from "./plugin-local-contributions";

// Navigation is outside this test; permission checks and UI registration stay real.
vi.mock("../../../router", () => ({ router: { navigate: vi.fn() } }));

function installedPlugin(grantedPermissions: PluginPermission[] = []): InstalledPlugin {
	return {
		id: "cli-proxy-api",
		name: "CLIProxyAPI",
		version: "1.0.3",
		activeVersion: "1.0.3",
		pluginApiVersion: "^2.0.0",
		entryUrl: "vetta-plugin://cli-proxy-api/dist/mf-manifest.json",
		moduleFederation: { remoteName: "cli_proxy_api", expose: "./plugin" },
		styleUrls: [],
		permissions: ["ui.slot.ability-detail", "shell.openExternal", "models.manage", "network.fetch"],
		grantedPermissions,
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "en",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-09-03T00:00:00Z",
		updatedAt: "2026-09-03T00:00:00Z",
		source: "remote",
		trustLevel: "community",
		rootPath: "/plugins/cli-proxy-api",
	};
}

const configuration = { id: "setup", abilityId: "cli-proxy-api", component: () => null };

async function activate(plugin: InstalledPlugin) {
	const contributions = new PluginLocalContributions();
	const disposers: Array<() => void> = [];
	const ctx = createPluginContext({
		plugin,
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
		disposers,
		pendingRuntimeRegistrations: [],
		activationId: "test-activation",
		capabilitySessionId: "test-capability",
	});
	ctx.ui.registerAbilityDetailSlot(configuration);
	return contributions.toLoadedPlugin(plugin, async () => {
		for (const dispose of disposers) dispose();
		contributions.clear();
	});
}

beforeEach(() => vi.stubGlobal("vetta", { plugins: { internalCapabilities: {} } }));
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("ability detail permission recovery", () => {
	it("reproduces the exact warning for empty grants and restores registration after a permission reload", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const onError = vi.fn();
		const denied = installedPlugin();
		const initial = await loadPluginSnapshot([denied], [], undefined, activate, onError);

		expect(warn).toHaveBeenCalledWith(
			"Plugin cli-proxy-api skipped ability detail slot: missing permission ui.slot.ability-detail",
		);
		expect(initial[0]?.abilityDetailSlots).toEqual([]);
		expect(denied.grantedPermissions).toEqual([]);
		warn.mockClear();

		const approved = installedPlugin(["ui.slot.ability-detail"]);
		const reloaded = await loadPluginSnapshot([approved], initial, new Set([approved.id]), activate, onError);

		expect(reloaded[0]).not.toBe(initial[0]);
		expect(reloaded[0]?.abilityDetailSlots).toEqual([{ ...configuration, id: "cli-proxy-api:setup" }]);
		expect(warn).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		for (const plugin of [...initial, ...reloaded]) await plugin.dispose();
	});

	it("does not accept an undeclared grant or register a panel after revocation", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const undeclared = await activate({ ...installedPlugin(["ui.slot.ability-detail"]), permissions: [] });
		const revoked = await activate(installedPlugin());
		expect(undeclared.abilityDetailSlots).toEqual([]);
		expect(revoked.abilityDetailSlots).toEqual([]);
		expect(warn).toHaveBeenCalledTimes(2);
		await undeclared.dispose();
		await revoked.dispose();
	});
});
