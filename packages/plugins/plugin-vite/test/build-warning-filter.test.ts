import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build } from "vite";
import type { Rollup } from "vite";
import { isIgnorableThirdPartyClientDirective } from "../src/build-warning-filter.js";
import { vettaPluginFederation } from "../src/index.js";

const temporaryDirectories: string[] = [];
const originalFederationTestOverride = process.env.MFE_VITE_NO_TEST_ENV_CHECK;
const mediaViewerRequire = createRequire(
	fileURLToPath(new URL("../../presets/media-viewer/package.json", import.meta.url)),
);
const vettaUiRoot = fileURLToPath(new URL("../../../ui", import.meta.url));

beforeEach(() => {
	process.env.MFE_VITE_NO_TEST_ENV_CHECK = "true";
});

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	if (originalFederationTestOverride === undefined) delete process.env.MFE_VITE_NO_TEST_ENV_CHECK;
	else process.env.MFE_VITE_NO_TEST_ENV_CHECK = originalFederationTestOverride;
});

describe("plugin build warning filter", () => {
	it("recognizes only third-party use-client directive warnings", () => {
		const warning: Rollup.RollupLog = {
			code: "MODULE_LEVEL_DIRECTIVE",
			id: "C:\\repo\\node_modules\\framer-motion\\dist\\es\\render\\svg\\use-props.mjs",
			message:
				'Module level directives cause errors when bundled, "use client" in "node_modules/framer-motion/dist/es/render/svg/use-props.mjs" was ignored.',
		};

		expect(isIgnorableThirdPartyClientDirective(warning)).toBe(true);
		expect(
			isIgnorableThirdPartyClientDirective({
				...warning,
				id: "../../node_modules/.bun/@pierre+trees@0.3.1/node_modules/@pierre/trees/dist/index.js",
			}),
		).toBe(true);
		expect(isIgnorableThirdPartyClientDirective({ ...warning, id: "C:\\repo\\src\\plugin.ts" })).toBe(false);
		expect(isIgnorableThirdPartyClientDirective({ ...warning, code: "CIRCULAR_DEPENDENCY" })).toBe(false);
		expect(
			isIgnorableThirdPartyClientDirective({
				...warning,
				message: warning.message.replace('"use client"', '"use server"'),
			}),
		).toBe(false);
	});

	it("filters a dependency directive while preserving the same warning from plugin source", async () => {
		const rootDir = await createDirectiveFixture();
		const warnings: Rollup.RollupLog[] = [];
		const originalCwd = process.cwd();
		process.chdir(rootDir);
		try {
			await build({
				root: rootDir,
				configFile: false,
				logLevel: "silent",
				build: {
					rollupOptions: {
						onwarn(warning) {
							warnings.push(warning);
						},
					},
				},
				plugins: vettaPluginFederation({
					name: "warning_filter_fixture",
					entry: "./src/index.js",
					package: false,
				}),
			});
		} finally {
			process.chdir(originalCwd);
		}

		expect(warnings.some((warning) => warning.id?.includes("framer-motion"))).toBe(false);
		expect(warnings.some((warning) => warning.id?.endsWith("local-client.js"))).toBe(true);
	});
});

async function createDirectiveFixture(): Promise<string> {
	const rootDir = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), "tmp-build-warning-filter-"));
	temporaryDirectories.push(rootDir);
	await Promise.all([
		mkdir(join(rootDir, "src"), { recursive: true }),
		mkdir(join(rootDir, "node_modules", "framer-motion", "dist", "es"), { recursive: true }),
		mkdir(join(rootDir, "node_modules", "@vetta"), { recursive: true }),
	]);
	await Promise.all([
		symlinkPackage(mediaViewerRequire.resolve("react/package.json"), join(rootDir, "node_modules", "react")),
		symlinkPackage(mediaViewerRequire.resolve("react-dom/package.json"), join(rootDir, "node_modules", "react-dom")),
		symlink(vettaUiRoot, join(rootDir, "node_modules", "@vetta", "ui"), "junction"),
		writeFile(join(rootDir, "package.json"), JSON.stringify({ private: true, type: "module" })),
		writeFile(
			join(rootDir, "plugin.json"),
			JSON.stringify({
				id: "warning-filter-fixture",
				name: "Warning filter fixture",
				version: "0.1.0",
				pluginApiVersion: "^1.0.0",
				entry: "dist/mf-manifest.json",
				moduleFederation: { remoteName: "warning_filter_fixture", expose: "./plugin" },
				permissions: [],
			}),
		),
		writeFile(
			join(rootDir, "node_modules", "framer-motion", "dist", "es", "client.js"),
			'"use client";\nexport const dependencyValue = "dependency";\n',
		),
		writeFile(join(rootDir, "src", "local-client.js"), '"use client";\nexport const localValue = "local";\n'),
		writeFile(
			join(rootDir, "src", "index.js"),
			`import { dependencyValue } from "../node_modules/framer-motion/dist/es/client.js";
import { localValue } from "./local-client.js";
export const values = [dependencyValue, localValue];
export default { activate() {} };
`,
		),
	]);
	return rootDir;
}

function symlinkPackage(packageJsonPath: string, targetPath: string): Promise<void> {
	return symlink(dirname(packageJsonPath), targetPath, "junction");
}
