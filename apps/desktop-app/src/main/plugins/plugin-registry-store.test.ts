import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { PluginRegistryStore, SystemPluginPreferenceStore } from "./plugin-registry-store.js";

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.0.0",
		runtime: "esm",
		entryUrl: "vetta-plugin://demo/index.js",
		styleUrls: [],
		permissions: ["ui.slot.global", "agent.command.run"],
		grantedPermissions: ["ui.slot.global", "agent.command.run"],
		allowedNetworkHosts: [],
		declaredCommands: ["demo.run"],
		grantedCommandNames: ["demo.run"],
		defaultLocale: "zh",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "remote",
		trustLevel: "official",
		rootPath: "stale",
		...overrides,
	};
}

describe("PluginRegistryStore", () => {
	it("normalizes user-editable trust and command permissions on read", () => {
		withDirectory((directory) => {
			const path = join(directory, "plugins-manifest.json");
			writeFileSync(path, JSON.stringify({ demo: plugin() }));
			const stored = new PluginRegistryStore(path, join(directory, "plugins")).read().demo;

			expect(stored).toMatchObject({ trustLevel: "community", permissions: ["ui.slot.global"] });
			expect(stored.declaredCommands).toEqual([]);
			expect(stored.rootPath).toBe(join(directory, "plugins", "demo", "versions", "1.0.0"));
		});
	});

	it("treats malformed persisted JSON as an empty registry", () => {
		withDirectory((directory) => {
			const path = join(directory, "plugins-manifest.json");
			writeFileSync(path, "{");
			expect(new PluginRegistryStore(path, join(directory, "plugins")).read()).toEqual({});
		});
	});
});

describe("SystemPluginPreferenceStore", () => {
	it("round-trips preferences independently from the user registry", () => {
		withDirectory((directory) => {
			const path = join(directory, "system-plugin-prefs.json");
			const store = new SystemPluginPreferenceStore(path);
			store.write({ core: { enabled: false, disabledCommands: ["core.run"] } });
			expect(store.read()).toEqual({ core: { enabled: false, disabledCommands: ["core.run"] } });
			expect(readFileSync(path, "utf8")).toContain("core.run");
		});
	});
});

function withDirectory(run: (directory: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "vetta-plugin-registry-"));
	try {
		run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
