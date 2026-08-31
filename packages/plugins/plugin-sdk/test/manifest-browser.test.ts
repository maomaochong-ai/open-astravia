import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest.js";

const baseManifest = {
	id: "publisher",
	name: "Publisher",
	version: "1.0.0",
	pluginApiVersion: "^1",
	entry: "dist/mf-manifest.json",
	moduleFederation: { remoteName: "publisher", expose: "./plugin" },
};

describe("plugin browser manifest", () => {
	it("allows plugins with no browser permissions or host declaration", () => {
		const manifest = parsePluginManifest(baseManifest);
		expect(manifest.permissions).toEqual([]);
		expect(manifest.browser).toBeUndefined();
	});

	it("allows open-only access and requires an explicit host declaration", () => {
		expect(() => parsePluginManifest({ ...baseManifest, permissions: ["browser.open"] })).toThrow(
			"browser.allowedHosts is required",
		);
		const manifest = parsePluginManifest({
			...baseManifest,
			permissions: ["browser.open"],
			browser: { allowedHosts: ["example.com"] },
		});
		expect(manifest.permissions).toEqual(["browser.open"]);
		expect(manifest.browser?.allowedHosts).toEqual(["example.com"]);
	});

	it("requires and normalizes browser host declarations", () => {
		expect(() =>
			parsePluginManifest({ ...baseManifest, permissions: ["browser.read"] }),
		).toThrow("browser.allowedHosts is required");

		const manifest = parsePluginManifest({
			...baseManifest,
			permissions: ["browser.read", "browser.interact"],
			browser: { allowedHosts: [" EXAMPLE.COM. ", "*.Docs.Example.com", "example.com"] },
		});
		expect(manifest.browser).toEqual({ allowedHosts: ["example.com", "*.docs.example.com"] });
	});

	it("requires read permission before interaction", () => {
		expect(() =>
			parsePluginManifest({
				...baseManifest,
				permissions: ["browser.interact"],
				browser: { allowedHosts: ["example.com"] },
			}),
		).toThrow("browser.interact requires browser.read");
	});

	it("rejects URL-shaped or port-specific host entries", () => {
		for (const host of ["https://example.com", "localhost:9222", "user@example.com"]) {
			expect(() =>
				parsePluginManifest({
					...baseManifest,
					permissions: ["browser.read"],
					browser: { allowedHosts: [host] },
				}),
			).toThrow("Invalid plugin browser.allowedHosts entry");
		}
	});
});
