import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest.js";

const baseManifest = {
	id: "network-test",
	name: "Network test",
	version: "1.0.0",
	pluginApiVersion: "^1.0.0",
	entry: "dist/index.js",
	permissions: ["network.fetch"],
};

describe("plugin network manifest", () => {
	it("requires host declarations for network.fetch", () => {
		expect(() => parsePluginManifest(baseManifest)).toThrow("network.allowedHosts is required");
	});

	it("normalizes exact, wildcard, localhost, and IPv6 hosts", () => {
		const manifest = parsePluginManifest({
			...baseManifest,
			network: { allowedHosts: ["API.Example.COM.", "*.CDN.Example.com", "localhost", "[::1]"] },
		});

		expect(manifest.network?.allowedHosts).toEqual(["api.example.com", "*.cdn.example.com", "localhost", "::1"]);
	});

	it("rejects URLs and ports in host declarations", () => {
		expect(() =>
			parsePluginManifest({ ...baseManifest, network: { allowedHosts: ["https://example.com"] } }),
		).toThrow("Invalid plugin network.allowedHosts entry");
		expect(() =>
			parsePluginManifest({ ...baseManifest, network: { allowedHosts: ["localhost:8188"] } }),
		).toThrow("Invalid plugin network.allowedHosts entry");
	});
});
