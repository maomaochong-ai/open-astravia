import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { parseMarketplaceManifest } from "./marketplace-schema";
import { createOpenMarketplacePluginArchive, validateOpenMarketplacePlugin } from "./open-marketplace-plugin";

const temporaryRoots: string[] = [];

async function fixture(id = "demo-plugin"): Promise<{
	sourceDir: string;
	ability: Extract<ReturnType<typeof parseMarketplaceManifest>["abilities"][number], { type: "plugin" }>;
}> {
	const root = await mkdtemp(join(tmpdir(), "vetta-open-plugin-test-"));
	temporaryRoots.push(root);
	const sourceDir = join(root, "abilities", "plugins", "demo-plugin");
	await mkdir(join(sourceDir, "dist"), { recursive: true });
	await writeFile(
		join(sourceDir, "plugin.json"),
		JSON.stringify({
			id,
			name: "Demo Plugin",
			version: "1.0.0",
			pluginApiVersion: "1.1.0",
			entry: "dist/index.js",
			permissions: ["storage.read"],
			commands: ["git"],
		}),
		"utf-8",
	);
	await writeFile(join(sourceDir, "dist", "index.js"), "export default {};\n", "utf-8");
	const manifest = parseMarketplaceManifest({
		schemaVersion: 1,
		name: "test-market",
		marketplaceVersion: "2026.07.3",
		repository: "https://github.com/example/test-market",
		minAppVersion: "0.5.11",
		abilities: [
			{
				type: "plugin",
				slug: "demo-plugin",
				name: "Demo Plugin",
				version: "1.0.0",
				source: { path: "abilities/plugins/demo-plugin" },
			},
		],
	});
	const ability = manifest.abilities[0];
	if (!ability || ability.type !== "plugin") throw new Error("Plugin fixture is missing");
	return { sourceDir, ability };
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("open marketplace plugin package", () => {
	it("derives catalog configuration from plugin.json and creates an installable archive", async () => {
		const { sourceDir, ability } = await fixture();

		expect(validateOpenMarketplacePlugin(sourceDir, ability)).toEqual({
			api_version: "1.1.0",
			permissions: ["storage.read"],
			commands: ["git"],
		});
		const archive = new AdmZip(createOpenMarketplacePluginArchive(sourceDir));
		expect(archive.getEntry("plugin.json")).not.toBeNull();
		expect(archive.getEntry("dist/index.js")).not.toBeNull();
	});

	it("rejects a plugin whose id does not match the marketplace slug", async () => {
		const { sourceDir, ability } = await fixture("other-plugin");

		expect(() => validateOpenMarketplacePlugin(sourceDir, ability)).toThrow("does not match ability slug");
	});
});
