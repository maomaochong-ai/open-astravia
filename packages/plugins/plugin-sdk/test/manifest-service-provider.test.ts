import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest.js";

const baseManifest = {
	id: "managed-bridge",
	name: "Managed Bridge",
	version: "1.0.0",
	pluginApiVersion: "^1.5.0",
	entry: "dist/mf-manifest.json",
	moduleFederation: { remoteName: "managed_bridge", expose: "./plugin" },
};

function service() {
	return {
		id: "proxy",
		runtime: {
			version: "2.4.1+extension.1.2.0",
			platforms: {
				"win32-x64": {
					executable: "core/bridge.exe",
					artifacts: [
						{
							sha256: "a".repeat(64),
							archive: "zip",
							destination: "core",
						},
					],
				},
			},
		},
		credentials: [{ id: "api-key", bytes: 32 }, { id: "management-key", bytes: 32 }],
		templates: [{ source: "assets/config.yaml.tpl", destination: "config.yaml", mode: "create" }],
		process: { args: ["--config", "${VETTA_SERVICE_DATA_DIR}/config.yaml"] },
		health: { path: "/v1/models", credentialId: "api-key", timeoutMs: 30_000 },
	} as const;
}

describe("plugin service provider manifest", () => {
	it("accepts per-start cache rendering independently from persistent create templates", () => {
		const provider = service();
		const manifest = parsePluginManifest({ ...baseManifest, providers: { services: [{ ...provider,
			templates: [{ ...provider.templates[0], mode: "render" }],
			process: { args: ["--config", "${VETTA_SERVICE_CACHE_DIR}/config.yaml"] },
		}] } });
		expect(manifest.providers?.services?.[0]?.templates?.[0]?.mode).toBe("render");
	});
	it("normalizes service layouts without embedding download sources", () => {
		const manifest = parsePluginManifest({ ...baseManifest, providers: { services: [service()] } });

		expect(manifest.providers?.services).toEqual([service()]);
	});

	it("rejects duplicate service ids and artifact destinations", () => {
		const provider = service();
		expect(() =>
			parsePluginManifest({ ...baseManifest, providers: { services: [provider, provider] } }),
		).toThrow("Duplicate service provider id");

		expect(() =>
			parsePluginManifest({
				...baseManifest,
				providers: {
					services: [
						{
							...provider,
							runtime: {
								...provider.runtime,
								platforms: {
									"win32-x64": {
										...provider.runtime.platforms["win32-x64"],
										artifacts: [
											...provider.runtime.platforms["win32-x64"].artifacts,
											{
												...provider.runtime.platforms["win32-x64"].artifacts[0],
												sha256: "b".repeat(64),
											},
										],
									},
								},
							},
						},
					],
				},
			}),
		).toThrow("Duplicate service artifact destination");
	});

	it("rejects host-owned download sources or unsafe artifact declarations", () => {
		const provider = service();
		const artifact = provider.runtime.platforms["win32-x64"].artifacts[0];
		const withArtifact = (replacement: Record<string, unknown>) => ({
			...baseManifest,
			providers: {
				services: [
					{
						...provider,
						runtime: {
							...provider.runtime,
							platforms: {
								"win32-x64": {
									...provider.runtime.platforms["win32-x64"],
									artifacts: [{ ...artifact, ...replacement }],
								},
							},
						},
					},
				],
			},
		});

		expect(() => parsePluginManifest(withArtifact({ url: "https://example.com/core.zip" }))).toThrow("providers");
		expect(() => parsePluginManifest(withArtifact({ sha256: "latest" }))).toThrow("providers");
		expect(() => parsePluginManifest(withArtifact({ destination: "../escape" }))).toThrow("artifacts.destination");
	});

	it("rejects unknown credential references and unsafe template paths", () => {
		const provider = service();
		expect(() =>
			parsePluginManifest({
				...baseManifest,
				providers: { services: [{ ...provider, health: { ...provider.health, credentialId: "missing" } }] },
			}),
		).toThrow("Unknown service health credential");
		expect(() =>
			parsePluginManifest({
				...baseManifest,
				providers: {
					services: [{ ...provider, templates: [{ ...provider.templates[0], source: "../config.yaml" }] }],
				},
			}),
		).toThrow("templates.source");
	});
});
