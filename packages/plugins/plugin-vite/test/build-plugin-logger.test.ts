import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("plugin logger production binding", () => {
	it("embeds the validated manifest identity instead of the SDK fallback logger", async () => {
		const rootDir = await createFixture();
		const originalCwd = process.cwd();
		process.chdir(rootDir);
		try {
			await build({
				root: rootDir,
				configFile: false,
				logLevel: "silent",
				plugins: vettaPluginFederation({
					name: "logger_fixture",
					entry: "./src/index.js",
					package: false,
				}),
			});
		} finally {
			process.chdir(originalCwd);
		}

		const output = await readJavaScriptOutput(join(rootDir, "dist"));
		expect(output).toContain('{id:"logger-fixture",version:"1.2.3"}');
		expect(output).toContain('from"vetta-host://plugin-sdk"');
		expect(output).not.toContain("Plugin logger is not bound");
	});
});

async function createFixture(): Promise<string> {
	const rootDir = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), "tmp-plugin-logger-"));
	temporaryDirectories.push(rootDir);
	await mkdir(join(rootDir, "src"), { recursive: true });
	await Promise.all([
		writeFile(join(rootDir, "package.json"), JSON.stringify({ private: true, type: "module" })),
		writeFile(
			join(rootDir, "plugin.json"),
			JSON.stringify({
				id: "logger-fixture",
				name: "Logger fixture",
				version: "1.2.3",
				pluginApiVersion: "^2.5.0",
				entry: "dist/mf-manifest.json",
				moduleFederation: { remoteName: "logger_fixture", expose: "./plugin" },
				permissions: [],
			}),
		),
		writeFile(
			join(rootDir, "src", "index.js"),
			`import { logger } from "@vetta-org/plugin-sdk/logger";
export const boundLogger = logger;
export default { activate() { logger.info("fixture activated"); } };
`,
		),
	]);
	return rootDir;
}

async function readJavaScriptOutput(directory: string): Promise<string> {
	const entries = await readdir(directory, { recursive: true, withFileTypes: true });
	const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".js"));
	return (
		await Promise.all(
			files.map((entry) => readFile(join(entry.parentPath, entry.name), "utf8")),
		)
	).join("\n");
}
