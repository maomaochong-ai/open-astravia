import { describe, expect, it } from "vitest";
import { parseVettaNpmPluginPackage } from "../src/npm-package.js";

const validPackage = {
	name: "@example/vetta-plugin-demo",
	version: "1.2.3",
	vetta: {
		schemaVersion: 1,
		type: "desktop-plugin",
		pluginId: "demo",
		archive: "release/vetta-plugin.zip",
	},
};

describe("parseVettaNpmPluginPackage", () => {
	it("parses a valid npm plugin distribution envelope", () => {
		expect(parseVettaNpmPluginPackage(validPackage)).toEqual(validPackage);
	});

	it("rejects archive paths that escape the npm package", () => {
		expect(() =>
			parseVettaNpmPluginPackage({
				...validPackage,
				vetta: { ...validPackage.vetta, archive: "../plugin.zip" },
			}),
		).toThrow("npm archive");
	});

	it("rejects unsupported metadata versions and extra fields", () => {
		expect(() =>
			parseVettaNpmPluginPackage({
				...validPackage,
				vetta: { ...validPackage.vetta, schemaVersion: 2 },
			}),
		).toThrow("schema version 1");
		expect(() =>
			parseVettaNpmPluginPackage({
				...validPackage,
				vetta: { ...validPackage.vetta, unexpected: true },
			}),
		).toThrow("schema version 1");
	});
});
