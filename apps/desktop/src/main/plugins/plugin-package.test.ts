import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import type { InstalledPlugin, PluginManifest } from "../../preload/api-types/plugins.js";
import { createInstalledPluginFromManifest, readPluginManifestFromArchive } from "./plugin-package.js";

const manifest: PluginManifest = {
	id: "demo",
	name: "Demo",
	version: "2.0.0",
	pluginApiVersion: "^2.0.0",
	entry: "dist/mf-manifest.json",
	moduleFederation: { remoteName: "demo", expose: "./plugin" },
	permissions: ["agent.skills.control", "agent.command.run"],
	commands: ["demo.run"],
};

function previousPlugin(): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^2.0.0",
		moduleFederation: { remoteName: "package_test", expose: "./plugin" },
		entryUrl: "vetta-plugin://demo/versions/1.0.0/dist/mf-manifest.json?v=1.0.0",
		styleUrls: [],
		permissions: ["agent.skills.control"],
		grantedPermissions: ["agent.skills.control"],
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
		rootPath: "C:/plugins/demo/versions/1.0.0",
	};
}

describe("createInstalledPluginFromManifest", () => {
	it("preserves explicitly granted command capabilities for remote packages", () => {
		const installed = createInstalledPluginFromManifest({
			manifest,
			options: { source: "remote", grantedPermissions: ["agent.skills.control", "agent.command.run"] },
			locales: {},
			hostApiVersion: "2.0.0",
			rootPath: "C:/plugins/demo/versions/2.0.0",
			reloadToken: "1",
		});

		expect(installed).toMatchObject({
			trustLevel: "community",
			permissions: ["agent.skills.control", "agent.command.run"],
			grantedPermissions: ["agent.skills.control", "agent.command.run"],
			declaredCommands: ["demo.run"],
		});
	});

	it("activates the installed version and repoints every resource at it", () => {
		const installed = createInstalledPluginFromManifest({
			manifest,
			previous: previousPlugin(),
			locales: {},
			hostApiVersion: "2.0.0",
			rootPath: "C:/plugins/demo/versions/2.0.0",
			reloadToken: "42",
		});

		expect(installed).toMatchObject({
			version: "2.0.0",
			activeVersion: "2.0.0",
			// 升级不自动扩大授权：新声明的 agent.command.run 仍未授予。
			grantedPermissions: ["agent.skills.control"],
			entryUrl: "vetta-plugin://demo/versions/2.0.0/dist/mf-manifest.json?v=2.0.0&reload=42",
			moduleFederation: { remoteName: "demo", expose: "./plugin" },
		});
		expect(installed.pendingVersion).toBeUndefined();
	});

	it("prunes removed permissions without granting new declarations on update", () => {
		const installed = createInstalledPluginFromManifest({
			manifest: { ...manifest, permissions: ["agent.command.run"] },
			previous: previousPlugin(),
			options: { source: "remote" },
			locales: {},
			hostApiVersion: "2.0.0",
			rootPath: "C:/plugins/demo/versions/2.0.0",
			reloadToken: "1",
		});

		expect(installed.permissions).toEqual(["agent.command.run"]);
		expect(installed.grantedPermissions).toEqual([]);
	});
});

describe("readPluginManifestFromArchive", () => {
	it.each(["plugin.json", "demo/plugin.json"])("recognizes a Vetta package whose manifest is at %s", (path) => {
		const archive = new AdmZip();
		archive.addFile(path, Buffer.from(JSON.stringify(manifest)));

		expect(readPluginManifestFromArchive(archive.toBuffer())).toMatchObject({ id: "demo", version: "2.0.0" });
	});

	it("rejects an archive without an identifiable plugin manifest", () => {
		const archive = new AdmZip();
		archive.addFile("README.md", Buffer.from("not a plugin"));

		expect(() => readPluginManifestFromArchive(archive.toBuffer())).toThrow("plugin.json not found");
	});

	it("rejects an ambiguous nested package root", () => {
		const archive = new AdmZip();
		archive.addFile("demo/plugin.json", Buffer.from(JSON.stringify(manifest)));
		archive.addFile("other/readme.md", Buffer.from("unexpected second root"));

		expect(() => readPluginManifestFromArchive(archive.toBuffer())).toThrow("plugin.json not found");
	});
});
