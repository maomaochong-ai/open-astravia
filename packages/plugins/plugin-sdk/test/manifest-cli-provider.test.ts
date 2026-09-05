import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest.js";

const baseManifest = {
	id: "feishu",
	name: "Feishu",
	version: "1.0.0",
	pluginApiVersion: "^2.0.0",
	entry: "dist/mf-manifest.json",
	moduleFederation: { remoteName: "feishu", expose: "./plugin" },
};

describe("plugin CLI provider manifest", () => {
	it("normalizes a declarative probe and installer", () => {
		const manifest = parsePluginManifest({
			...baseManifest,
			providers: {
				cli: [
					{
						id: "lark-cli",
						command: "lark-cli",
						probe: { args: ["--version"], timeoutMs: 10_000 },
						install: { command: "npx", args: ["-y", "@larksuite/cli@latest", "install"] },
					},
				],
			},
		});

		expect(manifest.providers?.cli).toEqual([
			expect.objectContaining({ id: "lark-cli", command: "lark-cli" }),
		]);
	});

	it("rejects duplicate provider ids and shell command strings", () => {
		const provider = { id: "lark-cli", command: "lark-cli", install: { command: "npx" } };
		expect(() =>
			parsePluginManifest({ ...baseManifest, providers: { cli: [provider, provider] } }),
		).toThrow("Duplicate CLI provider id");
		expect(() =>
			parsePluginManifest({
				...baseManifest,
				providers: { cli: [{ ...provider, install: { command: "npm install -g" } }] },
			}),
		).toThrow("providers");
	});
});
