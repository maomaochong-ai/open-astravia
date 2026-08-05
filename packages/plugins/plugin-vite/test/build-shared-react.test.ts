import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { vettaPluginFederation } from "../src/index.js";

const temporaryDirectories: string[] = [];
const originalFederationTestOverride = process.env.MFE_VITE_NO_TEST_ENV_CHECK;
const contentCreationRequire = createRequire(
	fileURLToPath(new URL("../../presets/content-creation/package.json", import.meta.url)),
);
const xyflowRequire = createRequire(contentCreationRequire.resolve("@xyflow/react/package.json"));
const zustandRequire = createRequire(xyflowRequire.resolve("zustand/package.json"));

beforeEach(() => {
	process.env.MFE_VITE_NO_TEST_ENV_CHECK = "true";
});

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	if (originalFederationTestOverride === undefined) delete process.env.MFE_VITE_NO_TEST_ENV_CHECK;
	else process.env.MFE_VITE_NO_TEST_ENV_CHECK = originalFederationTestOverride;
});

describe("vettaPluginFederation production build", () => {
	it(
		"keeps transitive CommonJS React imports bound to the shared module",
		async () => {
			const rootDir = await createCommonJsReactFixture();
			const originalCwd = process.cwd();
			process.chdir(rootDir);
			try {
				await build({
					root: rootDir,
					configFile: false,
					logLevel: "silent",
					plugins: vettaPluginFederation({
						name: "shared_react_fixture",
						entry: "./src/index.js",
						package: false,
					}),
				});
			} finally {
				process.chdir(originalCwd);
			}

			const assetsDir = join(rootDir, "dist", "assets");
			const entryFile = (await readdir(assetsDir)).find((file) => /^index-.*\.js$/u.test(file));
			expect(entryFile).toBeDefined();
			const entryPath = join(assetsDir, entryFile ?? "");
			const entrySource = await readFile(entryPath, "utf8");
			expect(entrySource).not.toMatch(/\b(?:var|let|const)\s+[\w$]+\s*=\s*\$s\b/u);

			const useState = () => ["fixture-state"];
			const react = { useState };
			const globals = globalThis as typeof globalThis & Record<string, unknown>;
			const previousCache = globals.__mf_module_cache__;
			globals.__mf_module_cache__ = {
				share: { react: { ...react, default: react } },
				remote: {},
			};
			try {
				const exposed = (await import(`${pathToFileURL(entryPath).href}?test=${Date.now()}`)) as {
					capturedSelector?: unknown;
					capturedUseState?: unknown;
				};
				expect(exposed.capturedUseState).toBe(useState);
				expect(exposed.capturedSelector).toBeTypeOf("function");
			} finally {
				if (previousCache === undefined) delete globals.__mf_module_cache__;
				else globals.__mf_module_cache__ = previousCache;
				for (const key of Object.keys(globals)) {
					if (key.includes("shared_react_fixture")) delete globals[key];
				}
			}
		},
		30_000,
	);
});

async function createCommonJsReactFixture(): Promise<string> {
	const rootDir = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), "tmp-shared-react-"));
	temporaryDirectories.push(rootDir);
	await Promise.all([
		mkdir(join(rootDir, "src"), { recursive: true }),
		mkdir(join(rootDir, "node_modules"), { recursive: true }),
	]);
	await Promise.all([
		symlink(dirname(contentCreationRequire.resolve("react/package.json")), join(rootDir, "node_modules", "react"), "junction"),
		symlink(
			dirname(zustandRequire.resolve("use-sync-external-store/package.json")),
			join(rootDir, "node_modules", "use-sync-external-store"),
			"junction",
		),
		writeFile(join(rootDir, "package.json"), JSON.stringify({ private: true, type: "module" })),
		writeFile(join(rootDir, "plugin.json"), JSON.stringify({ id: "shared-react-fixture" })),
		writeFile(
			join(rootDir, "src", "index.js"),
			`import { useState } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";
export const directUseState = useState;
export const capturedUseState = useState;
export const capturedSelector = useSyncExternalStoreWithSelector;
export default { activate() {} };
`,
		),
	]);
	return rootDir;
}
