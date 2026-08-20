import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startUpdateFeedFixture } from "./e2e/update-feed-fixture.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(packageRoot, "dist", "main", "index.js");
const userDataDir = path.join(packageRoot, ".wdio-electron-user-data");
const configDirName = ".vetta-e2e";
const require = createRequire(import.meta.url);

/** Set to `1` to use electron-builder unpacked output (`release/*-unpacked`). */
const usePackaged = process.env.VETTA_E2E_PACKAGED === "1";
let updateFeedServer: Server | undefined;

function resolvePackagedBinaryPath(): string {
	const candidates =
		process.platform === "win32"
			? [path.join(packageRoot, "release", "win-unpacked", "Vetta.exe")]
			: process.platform === "darwin"
				? [
						path.join(packageRoot, "release", "mac-arm64", "Vetta.app", "Contents", "MacOS", "Vetta"),
						path.join(packageRoot, "release", "mac", "Vetta.app", "Contents", "MacOS", "Vetta"),
						path.join(packageRoot, "release", "mac-x64", "Vetta.app", "Contents", "MacOS", "Vetta"),
					]
				: [path.join(packageRoot, "release", "linux-unpacked", "Vetta")];

	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) {
		throw new Error(
			[
				"Packaged Electron binary not found. Run a pack script for this platform first, e.g.:",
				"  bun run pack:win:test",
				"  bun run pack:linux:test",
				`Tried:\n${candidates.map((p) => `  - ${p}`).join("\n")}`,
			].join("\n"),
		);
	}
	return found;
}

/**
 * Resolve the real electron executable under node_modules/electron.
 * Avoid official `appEntryPoint` mode: @wdio/electron-service points at
 * node_modules/.bin/electron, which is a .CMD shim under bun and cannot be
 * used as Chromedriver's chrome binary.
 */
function resolveElectronBinaryPath(): string {
	// The electron package exports the absolute path to its dist binary when required from Node.
	const electronBinary = require("electron") as string;
	if (!electronBinary || !existsSync(electronBinary)) {
		throw new Error(
			`Electron binary not found (got: ${String(electronBinary)}). Install the electron dependency in apps/desktop.`,
		);
	}
	return electronBinary;
}

function resolveElectronServiceOptions(): {
	appBinaryPath: string;
	appArgs: string[];
} {
	const isolationArgs = [`--user-data-dir=${userDataDir}`];

	if (usePackaged) {
		return {
			appBinaryPath: resolvePackagedBinaryPath(),
			appArgs: isolationArgs,
		};
	}

	if (!existsSync(mainEntry)) {
		throw new Error(
			`Main-process build artifact missing: ${mainEntry}. Run bun run build in apps/desktop first (or at least build:main + preload + renderer).`,
		);
	}

	return {
		appBinaryPath: resolveElectronBinaryPath(),
		// Equivalent to official appEntryPoint mode: electron --app=<main>
		appArgs: [`--app=${mainEntry}`, ...isolationArgs],
	};
}

// Child Electron inherits these: isolated config dir + skip dev DevTools.
process.env.VETTA_E2E = "1";
process.env.VETTA_CONFIG_DIR = process.env.VETTA_CONFIG_DIR ?? configDirName;
// App data roots under VETTA_HOME; user-data-dir only isolates Chromium profile.
process.env.VETTA_HOME = process.env.VETTA_HOME ?? path.join(homedir(), configDirName);

const electronServiceOptions = resolveElectronServiceOptions();

/** Excluded from the package tsconfig; loaded by @wdio/cli at runtime. */
export const config = {
	runner: "local",
	// Resolve from apps/desktop so monorepo root cwd does not matter.
	rootDir: packageRoot,
	specs: ["./e2e/**/*.e2e.ts"],
	exclude: [],
	maxInstances: 1,
	capabilities: [
		{
			browserName: "electron",
			"wdio:electronServiceOptions": electronServiceOptions,
		},
	],
	logLevel: "warn" as const,
	bail: 0,
	waitforTimeout: 15_000,
	connectionRetryTimeout: 120_000,
	connectionRetryCount: 2,
	services: [
		[
			"electron",
			{
				clearMocks: true,
			},
		],
	],
	framework: "mocha",
	reporters: ["spec"],
	mochaOpts: {
		ui: "bdd",
		timeout: 120_000,
	},
	onPrepare: async () => {
		if (!usePackaged || process.env.VETTA_E2E_UPDATE_FEED === "0") return;
		const version = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version: string };
		const fixture = await startUpdateFeedFixture({
			version: version.version,
			downloadable: process.platform === "linux",
		});
		updateFeedServer = fixture.server;
		process.env.VETTA_E2E_UPDATE_URL = fixture.url;
		console.log(`[wdio] packaged E2E update feed: ${fixture.url}`);
	},
	onComplete: () => {
		updateFeedServer?.close();
		updateFeedServer = undefined;
	},
};
