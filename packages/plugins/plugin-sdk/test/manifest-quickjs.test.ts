import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest.js";

const baseManifest = {
	id: "quickjs-test",
	name: "QuickJS test",
	version: "1.0.0",
	pluginApiVersion: "^1.0.0",
	entry: "dist/index.js",
	runtime: "quickjs",
} as const;

describe("QuickJS plugin manifest", () => {
	it("accepts the isolated runtime", () => {
		expect(parsePluginManifest(baseManifest).runtime).toBe("quickjs");
	});

	it("rejects custom styles", () => {
		expect(() => parsePluginManifest({ ...baseManifest, styles: ["dist/style.css"] })).toThrow(
			"QuickJS plugins cannot load custom styles",
		);
	});

	it("rejects Module Federation metadata", () => {
		expect(() =>
			parsePluginManifest({
				...baseManifest,
				moduleFederation: { remoteName: "quickjs_test", expose: "./plugin" },
			}),
		).toThrow("QuickJS plugins cannot declare moduleFederation metadata");
	});
});
