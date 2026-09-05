import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest.js";

const baseManifest = {
	id: "federation-test",
	name: "Federation test",
	version: "1.0.0",
	pluginApiVersion: "^2.0.0",
	entry: "dist/mf-manifest.json",
} as const;

describe("plugin manifest Module Federation contract", () => {
	it("requires Module Federation metadata", () => {
		expect(() => parsePluginManifest(baseManifest)).toThrow("moduleFederation");
	});

	it("normalizes the required remote metadata", () => {
		expect(
			parsePluginManifest({
				...baseManifest,
				moduleFederation: { remoteName: "federation_test", expose: "./plugin" },
			}).moduleFederation,
		).toEqual({ remoteName: "federation_test", expose: "./plugin" });
	});

	it("rejects a runtime selector instead of silently choosing another loader", () => {
		expect(() =>
			parsePluginManifest({
				...baseManifest,
				runtime: "legacy-loader",
				moduleFederation: { remoteName: "federation_test", expose: "./plugin" },
			}),
		).toThrow("runtime selection is unsupported");
	});
});
