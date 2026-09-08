import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
	InstalledPlugin,
	PluginManifest,
	PluginServiceProviderManifest,
} from "../../preload/api-types/plugins.js";

const testPaths = vi.hoisted(() => {
	const root = `${process.cwd()}/.tmp-plugin-catalog-reload-${process.pid}`;
	return {
		root,
		home: `${root}/home`,
		resources: `${root}/resources`,
	};
});

vi.mock("@vetta/action-rpc", () => ({ getVettaHomePath: () => testPaths.home }));
vi.mock("electron", () => ({
	app: { isPackaged: true, resourcesPath: testPaths.resources },
	webContents: { getAllWebContents: () => [] },
}));
vi.mock("../abilities/ability-ledger.js", () => ({
	recordAbilityInstall: vi.fn(),
	removeAbilityLedgerEntry: vi.fn(),
}));
vi.mock("../credentials/desktop-credential-vault.js", () => ({ getDesktopCredentialVault: () => ({}) }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { reloadPlugin } from "./plugin-catalog.js";

const PLUGIN_ID = "reload-service-test";
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const previousService: PluginServiceProviderManifest = {
	id: "bridge",
	runtime: {
		version: "1.0.0",
		platforms: {
			"win32-x64": {
				executable: "bridge.exe",
				artifacts: [{ sha256: "a".repeat(64), archive: "file", destination: "bridge.exe" }],
			},
		},
	},
	process: { args: ["--port=:${" + "VETTA_SERVICE_PORT}"] },
	health: { path: "/health" },
};
const updatedService: PluginServiceProviderManifest = {
	...previousService,
	process: { args: ["--headless=false", "--port=:${" + "VETTA_SERVICE_PORT}"] },
};

function createInstalledPlugin(): InstalledPlugin {
	return {
		id: PLUGIN_ID,
		name: "Reload service test",
		version: "2.0.0",
		activeVersion: "1.0.0",
		pendingVersion: "2.0.0",
		pluginApiVersion: "^2.0.0",
		entryUrl: `vetta-plugin://${PLUGIN_ID}/versions/1.0.0/dist/mf-manifest.json?v=1.0.0`,
		moduleFederation: { remoteName: "reload_service_test", expose: "./plugin" },
		serviceProviders: [previousService],
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
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
		rootPath: join(testPaths.home, "plugins", PLUGIN_ID, "versions", "1.0.0"),
	};
}

function createUpdatedManifest(): PluginManifest {
	return {
		id: PLUGIN_ID,
		name: "Reload service test",
		version: "2.0.0",
		pluginApiVersion: "^2.0.0",
		entry: "dist/mf-manifest.json",
		moduleFederation: { remoteName: "reload_service_test", expose: "./plugin" },
		providers: { services: [updatedService] },
	};
}

beforeAll(async () => {
	Object.defineProperty(process, "resourcesPath", { configurable: true, value: testPaths.resources });
	await rm(testPaths.root, { recursive: true, force: true });
	await mkdir(join(testPaths.resources, "system-plugins"), { recursive: true });
	await mkdir(join(testPaths.home, "plugins", PLUGIN_ID, "versions", "2.0.0", "dist"), {
		recursive: true,
	});
	await writeFile(
		join(testPaths.home, "plugins-manifest.json"),
		JSON.stringify({ [PLUGIN_ID]: createInstalledPlugin() }),
	);
	await writeFile(
		join(testPaths.home, "plugins", PLUGIN_ID, "versions", "2.0.0", "plugin.json"),
		JSON.stringify(createUpdatedManifest()),
	);
});

afterAll(async () => {
	await rm(testPaths.root, { recursive: true, force: true });
	if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
	else Reflect.deleteProperty(process, "resourcesPath");
});

describe("reloadPlugin", () => {
	it("applies updated managed service declarations when activating a pending version", async () => {
		const reloaded = reloadPlugin(PLUGIN_ID);

		expect(reloaded.activeVersion).toBe("2.0.0");
		expect(reloaded.pendingVersion).toBeUndefined();
		expect(reloaded.serviceProviders).toEqual([updatedService]);

		const registry = JSON.parse(await readFile(join(testPaths.home, "plugins-manifest.json"), "utf-8")) as Record<
			string,
			InstalledPlugin
		>;
		expect(registry[PLUGIN_ID]?.serviceProviders).toEqual([updatedService]);
	});
});
