import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createVettaPluginPackage } from "../src/pack.js";

const temporaryDirectories: string[] = [];

interface FederationFixtureOptions {
	id: string;
	version: string;
	permissions?: string[];
	remoteEntryCode?: string;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFederationFixture(options: FederationFixtureOptions): Promise<string> {
	const rootDir = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), "tmp-pack-"));
	temporaryDirectories.push(rootDir);
	await mkdir(join(rootDir, "dist", "assets"), { recursive: true });
	await writeFile(
		join(rootDir, "plugin.json"),
		JSON.stringify({
			id: options.id,
			name: options.id,
			version: options.version,
			pluginApiVersion: "^2.0.0",
			entry: "dist/mf-manifest.json",
			moduleFederation: { remoteName: options.id.replaceAll("-", "_"), expose: "./plugin" },
			permissions: options.permissions ?? [],
		}),
	);
	await writeFile(
		join(rootDir, "dist", "mf-manifest.json"),
		JSON.stringify({ metaData: { remoteEntry: { name: "remoteEntry.js" } } }),
	);
	await writeFile(join(rootDir, "dist", "remoteEntry.js"), options.remoteEntryCode ?? "export function activate() {}\n");
	return rootDir;
}

describe("createVettaPluginPackage", () => {
	it("packages the federation manifest and remote entry", async () => {
		const rootDir = await createFederationFixture({ id: "pack-test", version: "0.1.0" });
		await mkdir(join(rootDir, "locales"), { recursive: true });
		await writeFile(join(rootDir, "locales", "en.json"), JSON.stringify({ title: "Test" }));

		const result = await createVettaPluginPackage({ rootDir });

		expect(result.files.map((file) => file.archivePath)).toEqual([
			"dist/mf-manifest.json",
			"dist/remoteEntry.js",
			"locales/en.json",
			"plugin.json",
		]);
		expect(result.outputPath).toBe(join(rootDir, "release", "pack-test-0.1.0.zip"));
	});

	it("packages ability details and presentation files", async () => {
		const rootDir = await createFederationFixture({ id: "ability-detail-test", version: "0.1.0" });
		await mkdir(join(rootDir, "presentation"), { recursive: true });
		await writeFile(join(rootDir, "presentation", "README.md"), "# Ability detail\n");
		await writeFile(
			join(rootDir, "ability.json"),
			JSON.stringify({
				schemaVersion: 1,
				type: "plugin",
				slug: "ability-detail-test",
				version: "0.1.0",
				detail: { blocks: [{ type: "markdown", path: "presentation/README.md" }] },
			}),
		);

		const result = await createVettaPluginPackage({ rootDir });

		expect(result.files.map((file) => file.archivePath)).toEqual([
			"ability.json",
			"dist/mf-manifest.json",
			"dist/remoteEntry.js",
			"plugin.json",
			"presentation/README.md",
		]);
	});

	it("writes a stable npm archive after validating package and plugin identity", async () => {
		const rootDir = await createFederationFixture({ id: "npm-pack-test", version: "0.2.0" });
		await writeFile(
			join(rootDir, "package.json"),
			JSON.stringify({
				name: "@example/vetta-plugin-npm-pack-test",
				version: "0.2.0",
				vetta: {
					schemaVersion: 1,
					type: "desktop-plugin",
					pluginId: "npm-pack-test",
					archive: "release/vetta-plugin.zip",
				},
			}),
		);

		const result = await createVettaPluginPackage({ rootDir, npmArchive: true });

		expect(result.npmOutputPath).toBe(join(rootDir, "release", "vetta-plugin.zip"));
		expect(await readFile(result.npmOutputPath!)).toEqual(await readFile(result.outputPath));
	});

	it("rejects npm package identity drift", async () => {
		const rootDir = await createFederationFixture({ id: "identity-test", version: "1.0.0" });
		await writeFile(
			join(rootDir, "package.json"),
			JSON.stringify({
				name: "@example/identity-test",
				version: "1.0.1",
				vetta: {
					schemaVersion: 1,
					type: "desktop-plugin",
					pluginId: "identity-test",
					archive: "release/vetta-plugin.zip",
				},
			}),
		);

		await expect(createVettaPluginPackage({ rootDir, npmArchive: true })).rejects.toThrow(
			"must match plugin version",
		);
	});

	it("rejects a runtime capability whose permission is missing before writing an archive", async () => {
		const rootDir = await createFederationFixture({
			id: "permission-test",
			version: "1.0.0",
			permissions: ["agent.systemPrompt.write"],
			remoteEntryCode:
				'export function activate(ctx) { ctx.agent.registerSystemPromptProvider({ handler: () => [{ type: "setToolEnabled", toolName: "write", enabled: false }] }); }\n',
		});

		await expect(createVettaPluginPackage({ rootDir })).rejects.toThrow('requires "agent.tools.control"');
		await expect(readFile(join(rootDir, "release", "permission-test-1.0.0.zip"))).rejects.toThrow();
	});
});
