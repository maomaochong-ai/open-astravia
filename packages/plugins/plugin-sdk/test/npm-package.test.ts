import { describe, expect, it } from "vitest";
import { parseAstraviaNpmPluginPackage } from "../src/npm-package.js";

const validPackage = {
	name: "@example/astravia-plugin-demo",
	version: "1.2.3",
	astravia: {
		schemaVersion: 1,
		type: "desktop-plugin",
		pluginId: "demo",
		archive: "release/astravia-plugin.astraviapkg",
	},
};

describe("parseAstraviaNpmPluginPackage", () => {
	it("parses a valid npm plugin distribution envelope", () => {
		expect(parseAstraviaNpmPluginPackage(validPackage)).toEqual(validPackage);
	});

	it("rejects archive paths that escape the npm package", () => {
		expect(() =>
			parseAstraviaNpmPluginPackage({
				...validPackage,
				astravia: { ...validPackage.astravia, archive: "../plugin.zip" },
			}),
		).toThrow("npm archive");
	});

	it("rejects unsupported metadata versions and extra fields", () => {
		expect(() =>
			parseAstraviaNpmPluginPackage({
				...validPackage,
				astravia: { ...validPackage.astravia, schemaVersion: 2 },
			}),
		).toThrow("schema version 1");
		expect(() =>
			parseAstraviaNpmPluginPackage({
				...validPackage,
				astravia: { ...validPackage.astravia, unexpected: true },
			}),
		).toThrow("schema version 1");
	});
});
