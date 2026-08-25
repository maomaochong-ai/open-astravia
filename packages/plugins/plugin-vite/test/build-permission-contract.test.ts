import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginPermission } from "@vetta-org/plugin-sdk/manifest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { vettaPluginFederation } from "../src/index.js";

const temporaryDirectories: string[] = [];
const originalFederationTestOverride = process.env.MFE_VITE_NO_TEST_ENV_CHECK;

beforeEach(() => {
	process.env.MFE_VITE_NO_TEST_ENV_CHECK = "true";
});

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	if (originalFederationTestOverride === undefined) delete process.env.MFE_VITE_NO_TEST_ENV_CHECK;
	else process.env.MFE_VITE_NO_TEST_ENV_CHECK = originalFederationTestOverride;
});

describe("vettaPluginFederation permission contract", () => {
	it("fails the build before writing an invalid plugin bundle", async () => {
		const rootDir = await createFixture([]);
		await expect(buildFixture(rootDir)).rejects.toThrow('requires "agent.tools.control"');
		expect(existsSync(join(rootDir, "dist", "mf-manifest.json"))).toBe(false);
	});

	it("allows the same bundle after the manifest declares its permission", async () => {
		const rootDir = await createFixture(["agent.tools.control"]);
		await expect(buildFixture(rootDir)).resolves.toBeDefined();
		expect(existsSync(join(rootDir, "dist", "mf-manifest.json"))).toBe(true);
	});
});

async function buildFixture(rootDir: string) {
	const originalCwd = process.cwd();
	process.chdir(rootDir);
	try {
		return await build({
			root: rootDir,
			configFile: false,
			logLevel: "silent",
			plugins: vettaPluginFederation({
				name: "permission_contract_fixture",
				entry: "./src/index.js",
				package: false,
			}),
		});
	} finally {
		process.chdir(originalCwd);
	}
}

async function createFixture(permissions: readonly PluginPermission[]): Promise<string> {
	const rootDir = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), "tmp-build-permissions-"));
	temporaryDirectories.push(rootDir);
	await mkdir(join(rootDir, "src"), { recursive: true });
	await Promise.all([
		writeFile(join(rootDir, "package.json"), JSON.stringify({ private: true, type: "module" })),
		writeFile(
			join(rootDir, "plugin.json"),
			JSON.stringify({
				id: "permission-contract-fixture",
				name: "Permission contract fixture",
				version: "0.1.0",
				pluginApiVersion: "^1.0.0",
				runtime: "module-federation",
				entry: "dist/mf-manifest.json",
				moduleFederation: { remoteName: "permission_contract_fixture", expose: "./plugin" },
				permissions,
			}),
		),
		writeFile(
			join(rootDir, "src", "index.js"),
			`export default {
	activate() {
		return [{ type: "setToolEnabled", toolName: "demo", enabled: false }];
	},
};
`,
		),
	]);
	return rootDir;
}
