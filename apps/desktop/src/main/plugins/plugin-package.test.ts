import { describe, expect, it } from "vitest";
import type { InstalledPlugin, PluginManifest } from "../../preload/api-types/plugins.js";
import { createInstalledPluginFromManifest } from "./plugin-package.js";

const manifest: PluginManifest = {
	id: "demo",
	name: "Demo",
	version: "2.0.0",
	pluginApiVersion: "^1.0.0",
	entry: "dist/index.js",
	permissions: ["agent.skills.control", "agent.command.run"],
	commands: ["demo.run"],
};

function previousPlugin(): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.0.0",
		runtime: "esm",
		entryUrl: "vetta-plugin://demo/versions/1.0.0/dist/index.js?v=1.0.0",
		styleUrls: [],
		permissions: ["agent.skills.control"],
		grantedPermissions: ["agent.skills.control"],
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
		rootPath: "C:/plugins/demo/versions/1.0.0",
	};
}

describe("createInstalledPluginFromManifest", () => {
	it("removes official-only command capabilities from remote packages", () => {
		const installed = createInstalledPluginFromManifest({
			manifest,
			options: { source: "remote", grantedPermissions: ["agent.skills.control", "agent.command.run"] },
			locales: {},
			hostApiVersion: "1.3.0",
			rootPath: "C:/plugins/demo/versions/2.0.0",
		});

		expect(installed).toMatchObject({
			trustLevel: "community",
			permissions: ["agent.skills.control"],
			grantedPermissions: ["agent.skills.control"],
			declaredCommands: [],
		});
	});

	it("keeps the active version stable while an update is pending", () => {
		const installed = createInstalledPluginFromManifest({
			manifest,
			previous: previousPlugin(),
			locales: {},
			hostApiVersion: "1.3.0",
			rootPath: "C:/plugins/demo/versions/1.0.0",
		});

		expect(installed).toMatchObject({
			version: "2.0.0",
			activeVersion: "1.0.0",
			pendingVersion: "2.0.0",
			entryUrl: "vetta-plugin://demo/versions/1.0.0/dist/index.js?v=1.0.0",
		});
	});
});
