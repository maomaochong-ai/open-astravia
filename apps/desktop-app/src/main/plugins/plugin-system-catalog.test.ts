import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "../../preload/api-types/plugins.js";
import { SystemPluginPreferenceStore } from "./plugin-registry-store.js";
import { SystemPluginCatalog } from "./plugin-system-catalog.js";

const root = join(process.cwd(), `.tmp-system-plugin-catalog-${process.pid}`);
const pluginsDir = join(root, "plugins");
const preferences = new SystemPluginPreferenceStore(join(root, "preferences.json"));

async function writePlugin(manifest: PluginManifest, includeEntry = true): Promise<void> {
	const dir = join(pluginsDir, manifest.id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "plugin.json"), JSON.stringify(manifest));
	if (includeEntry) {
		await mkdir(join(dir, "dist"), { recursive: true });
		await writeFile(join(dir, manifest.entry), "export {};");
	}
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
	return {
		id: "system-demo",
		name: "System Demo",
		version: "1.0.0",
		pluginApiVersion: "^1.0.0",
		entry: "dist/index.js",
		commands: ["demo.run"],
		...overrides,
	};
}

function createCatalog(requiredPluginIds: ReadonlySet<string> = new Set()) {
	return new SystemPluginCatalog({
		baseDir: () => pluginsDir,
		preferences,
		requiredPluginIds,
		hostApiVersion: "1.3.0",
		isPackaged: true,
		registerModeGate: vi.fn(),
		logger: { warn: vi.fn() },
	});
}

beforeEach(async () => {
	await rm(root, { recursive: true, force: true });
	await mkdir(pluginsDir, { recursive: true });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("SystemPluginCatalog", () => {
	it("keeps required plugins enabled despite a disabled preference", async () => {
		await writePlugin(manifest());
		preferences.write({ "system-demo": { enabled: false } });

		const plugin = createCatalog(new Set(["system-demo"])).list()[0];
		expect(plugin).toMatchObject({ id: "system-demo", enabled: true, required: true, trustLevel: "official" });
	});

	it("skips an incomplete staged plugin without blocking discovery", async () => {
		await writePlugin(manifest({ id: "incomplete" }), false);
		await writePlugin(manifest({ id: "complete", name: "Complete" }));
		const catalog = createCatalog();

		expect(catalog.list().map((plugin) => plugin.id)).toEqual(["complete"]);
	});

	it("refreshes cached manifests only when forced", async () => {
		await writePlugin(manifest());
		const catalog = createCatalog();
		expect(catalog.list()[0]?.name).toBe("System Demo");

		await writePlugin(manifest({ name: "Updated" }));
		expect(catalog.list()[0]?.name).toBe("System Demo");
		expect(catalog.list(true)[0]?.name).toBe("Updated");
	});

	it("persists command disable and enable preferences", async () => {
		await writePlugin(manifest());
		const catalog = createCatalog();

		expect(catalog.revokeCommands("system-demo", ["demo.run"]).grantedCommandNames).toEqual([]);
		expect(catalog.grantCommands("system-demo", ["demo.run"]).grantedCommandNames).toEqual(["demo.run"]);
	});
});
