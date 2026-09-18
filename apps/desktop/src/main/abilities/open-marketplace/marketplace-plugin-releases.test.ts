import { describe, expect, it } from "vitest";
import { selectMarketplacePluginReleases } from "./marketplace-plugin-releases";
import { parseMarketplaceManifest } from "./marketplace-schema";

const digest = "a".repeat(64);

function catalog() {
	return parseMarketplaceManifest({
		schemaVersion: 3,
		name: "example",
		marketplaceVersion: "3",
		repository: "https://github.com/example/market",
		minAppVersion: "0.5.57",
		abilities: [
			{
				type: "plugin",
				slug: "demo",
				name: "Demo",
				version: "1.2.0",
				source: { path: "abilities/plugins/demo" },
				releases: [
					{
						version: "1.0.0",
						minAppVersion: "0.5.57",
						pluginApiVersion: "^2.4.0",
						permissions: ["storage.read"],
						artifact: { url: "https://example.com/demo-1.0.0.zip", sha256: digest },
					},
					{
						version: "1.2.0",
						minAppVersion: "0.5.58",
						pluginApiVersion: "^2.5.0",
						permissions: ["storage.write"],
						artifact: { url: "https://example.com/demo-1.2.0.zip", sha256: digest },
					},
				],
			},
			{
				type: "bundle",
				slug: "starter",
				name: "Starter",
				version: "1.0.0",
				config: { members: [{ type: "plugin", slug: "demo" }] },
			},
		],
	}).abilities;
}

describe("marketplace plugin release selection", () => {
	it("shows and installs the newest version supported by the user's App and Plugin API", () => {
		const older = selectMarketplacePluginReleases(catalog(), "0.5.57", "2.4.0");
		expect(older.find((ability) => ability.type === "plugin")).toMatchObject({
			version: "1.0.0",
			config: { api_version: "^2.4.0", permissions: ["storage.read"] },
			releases: [{ version: "1.0.0" }],
		});
		expect(older.some((ability) => ability.slug === "starter")).toBe(true);

		const newer = selectMarketplacePluginReleases(catalog(), "0.5.58", "2.5.0");
		expect(newer.find((ability) => ability.type === "plugin")).toMatchObject({
			version: "1.2.0",
			releases: [{ version: "1.2.0" }],
		});
	});

	it("does not offer an uninstalled plugin or a bundle when no release supports the host", () => {
		expect(selectMarketplacePluginReleases(catalog(), "0.5.57", "2.3.0")).toEqual([]);
	});

	it("rejects release declarations that could make the catalog lie about versions or artifact integrity", () => {
		const manifest = catalog();
		const plugin = manifest[0];
		if (!plugin || plugin.type !== "plugin" || !plugin.releases) throw new Error("Plugin fixture is missing");
		const releases = plugin.releases;
		const base = {
			schemaVersion: 3,
			name: "example",
			marketplaceVersion: "3",
			repository: "https://github.com/example/market",
			minAppVersion: "0.5.57",
			abilities: [plugin],
		};
		expect(() => parseMarketplaceManifest({ ...base, schemaVersion: 2 })).toThrow(/schemaVersion 3/);
		expect(() => parseMarketplaceManifest({ ...base, abilities: [{ ...plugin, version: "1.0.0" }] })).toThrow(
			/latest release/,
		);
		expect(() =>
			parseMarketplaceManifest({
				...base,
				abilities: [
					{
						...plugin,
						releases: [{ ...releases[0], artifact: { url: "http://example.com/a.zip", sha256: digest } }],
					},
				],
			}),
		).toThrow();
	});
});
