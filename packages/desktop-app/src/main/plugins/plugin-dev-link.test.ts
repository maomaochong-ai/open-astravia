import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin, PluginManifest } from "../../preload/api-types/plugins.js";

const testPaths = vi.hoisted(() => {
	const root = `${process.cwd()}/.tmp-plugin-dev-link-${process.pid}`;
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
vi.mock("../credentials/desktop-credential-vault.js", () => ({ getDesktopCredentialVault: () => ({}) }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
	clearPluginDevLink,
	discoverSystemPlugins,
	listPlugins,
	refreshPluginDevLink,
	setPluginDevLink,
} from "./plugin-store.js";

const SYSTEM_PLUGIN_ID = "system-dev-test";
const ARCHIVE_PLUGIN_ID = "archive-dev-test";
const REMOTE_PLUGIN_ID = "remote-dev-test";
const EPHEMERAL_PLUGIN_ID = "ephemeral-dev-test";
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");

function createManifest(id: string, name: string): PluginManifest {
	return {
		id,
		name,
		version: "1.0.0",
		pluginApiVersion: "^1.0.0",
		runtime: "module-federation",
		entry: "dist/mf-manifest.json",
		moduleFederation: { remoteName: id.replaceAll("-", "_"), expose: "./plugin" },
		permissions: ["ui.slot.global", "agent.tools.register", "agent.command.run"],
		commands: [`${id}.run`],
	};
}

function createInstalledPlugin(id: string, source: "archive" | "remote"): InstalledPlugin {
	return {
		id,
		name: id,
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.0.0",
		runtime: "module-federation",
		entryUrl: `vetta-plugin://${id}/versions/1.0.0/dist/mf-manifest.json`,
		moduleFederation: { remoteName: id.replaceAll("-", "_"), expose: "./plugin" },
		styleUrls: [],
		permissions: ["ui.slot.global"],
		grantedPermissions: ["ui.slot.global"],
		allowedNetworkHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "zh",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source,
		trustLevel: source === "remote" ? "community" : "local",
		rootPath: join(testPaths.home, "plugins", id, "versions", "1.0.0"),
	};
}

async function writePluginProject(directory: string, manifest: PluginManifest): Promise<void> {
	await mkdir(join(directory, "dist"), { recursive: true });
	await writeFile(join(directory, "plugin.json"), JSON.stringify(manifest));
	await writeFile(join(directory, "dist", "mf-manifest.json"), "{}");
}

beforeAll(async () => {
	Object.defineProperty(process, "resourcesPath", { configurable: true, value: testPaths.resources });
	await rm(testPaths.root, { recursive: true, force: true });
	await mkdir(testPaths.home, { recursive: true });
	await writePluginProject(
		join(testPaths.resources, "system-plugins", SYSTEM_PLUGIN_ID),
		createManifest(SYSTEM_PLUGIN_ID, "System installed"),
	);
	await writeFile(
		join(testPaths.home, "plugins-manifest.json"),
		JSON.stringify({
			[ARCHIVE_PLUGIN_ID]: createInstalledPlugin(ARCHIVE_PLUGIN_ID, "archive"),
			[REMOTE_PLUGIN_ID]: createInstalledPlugin(REMOTE_PLUGIN_ID, "remote"),
		}),
	);
	for (const [id, name] of [
		[SYSTEM_PLUGIN_ID, "System development"],
		[ARCHIVE_PLUGIN_ID, "Archive development"],
		[REMOTE_PLUGIN_ID, "Remote development"],
	] as const) {
		await writePluginProject(join(testPaths.root, "projects", id), createManifest(id, name));
	}
	discoverSystemPlugins(true);
});

afterAll(async () => {
	for (const id of [SYSTEM_PLUGIN_ID, ARCHIVE_PLUGIN_ID, REMOTE_PLUGIN_ID, EPHEMERAL_PLUGIN_ID])
		clearPluginDevLink(id);
	await rm(testPaths.root, { recursive: true, force: true });
	if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
	else Reflect.deleteProperty(process, "resourcesPath");
});

describe("plugin development links", () => {
	it.each([
		{ id: SYSTEM_PLUGIN_ID, source: "system", trustLevel: "official" },
		{ id: ARCHIVE_PLUGIN_ID, source: "archive", trustLevel: "local" },
		{ id: REMOTE_PLUGIN_ID, source: "remote", trustLevel: "community" },
	] as const)("applies the same development overlay to $source plugins", ({ id, source, trustLevel }) => {
		const projectDir = join(testPaths.root, "projects", id);
		const linked = setPluginDevLink(id, projectDir);

		expect(linked).toMatchObject({
			id,
			source,
			trustLevel,
			rootPath: projectDir,
			devWatch: { projectDir, status: "starting" },
		});
		expect(linked.grantedPermissions).toEqual(
			trustLevel === "official"
				? ["ui.slot.global", "agent.tools.register", "agent.command.run"]
				: ["ui.slot.global", "agent.tools.register"],
		);
		expect(linked.declaredCommands).toEqual(trustLevel === "official" ? [`${id}.run`] : []);
		expect(linked.grantedCommandNames).toEqual(trustLevel === "official" ? [`${id}.run`] : []);
		expect(listPlugins().find((plugin) => plugin.id === id)).toMatchObject({
			name: expect.stringContaining("development"),
			source,
			trustLevel,
			rootPath: projectDir,
			devWatch: { projectDir, status: "starting" },
		});
	});

	it("refreshes and clears a system plugin development overlay without changing its identity", async () => {
		const projectDir = join(testPaths.root, "projects", SYSTEM_PLUGIN_ID);
		const manifest = createManifest(SYSTEM_PLUGIN_ID, "System refreshed");
		manifest.version = "1.1.0";
		await writePluginProject(projectDir, manifest);

		expect(refreshPluginDevLink(SYSTEM_PLUGIN_ID)).toMatchObject({
			name: "System refreshed",
			version: "1.1.0",
			source: "system",
			trustLevel: "official",
			devWatch: { status: "running" },
		});

		clearPluginDevLink(SYSTEM_PLUGIN_ID);
		const restored = listPlugins().find((plugin) => plugin.id === SYSTEM_PLUGIN_ID);
		expect(restored).toMatchObject({
			name: "System installed",
			version: "1.0.0",
			source: "system",
			trustLevel: "official",
		});
		expect(restored).not.toHaveProperty("devWatch");
	});

	it("registers an explicitly selected uninstalled plugin only for the development session", async () => {
		const projectDir = join(testPaths.root, "projects", EPHEMERAL_PLUGIN_ID);
		await writePluginProject(projectDir, createManifest(EPHEMERAL_PLUGIN_ID, "Ephemeral development"));

		const linked = setPluginDevLink(EPHEMERAL_PLUGIN_ID, projectDir, { allowUninstalled: true });

		expect(linked).toMatchObject({
			id: EPHEMERAL_PLUGIN_ID,
			source: "archive",
			trustLevel: "local",
			enabled: true,
			rootPath: projectDir,
			devWatch: { projectDir, status: "starting" },
		});
		expect(listPlugins().some((plugin) => plugin.id === EPHEMERAL_PLUGIN_ID)).toBe(true);

		clearPluginDevLink(EPHEMERAL_PLUGIN_ID);
		expect(listPlugins().some((plugin) => plugin.id === EPHEMERAL_PLUGIN_ID)).toBe(false);
	});
});
