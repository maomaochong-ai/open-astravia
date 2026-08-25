import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startUpdateFeedFixture } from "./e2e/update-feed-fixture.mjs";
import {
	resolveElectronE2eServiceOptions,
	resolveElectronE2eSpecRetryOptions,
} from "./scripts/electron-e2e-service-options.mjs";
import {
	resolvePackagedE2eBinaryPath,
	stagePackagedE2eAppImage,
} from "./scripts/packaged-e2e-binary.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(packageRoot, "dist", "main", "index.js");
const userDataDir = path.join(packageRoot, ".wdio-electron-user-data");
const configDirName = ".vetta-e2e";
const require = createRequire(import.meta.url);
const packageVersion = (JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
	version: string;
}).version;

/** Set to `1` to use electron-builder unpacked output (`release/*-unpacked`). */
const usePackaged = process.env.VETTA_E2E_PACKAGED === "1";
const packagedArtifactRoot = process.env.VETTA_E2E_PACKAGED_ROOT?.trim()
	? path.resolve(process.env.VETTA_E2E_PACKAGED_ROOT)
	: packageRoot;
let updateFeedServer: Server | undefined;
let stagedAppImageRoot: string | undefined;

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
		if (process.platform === "linux") {
			// WDIO drives linux-unpacked/Vetta, but electron-updater only enables its
			// AppImage provider when the runtime supplies APPIMAGE. Stage a copy so
			// the updater replacement flow cannot mutate the release artifact uploaded after E2E.
			const staged = stagePackagedE2eAppImage(packagedArtifactRoot, packageVersion);
			stagedAppImageRoot = staged.stagingRoot;
			process.env.APPIMAGE = staged.appImagePath;
		}
		return {
			// Windows release/Vetta.exe is a detached stable launcher. ChromeDriver
			// must drive the versioned Electron executable that it launches.
			appBinaryPath: resolvePackagedE2eBinaryPath(packagedArtifactRoot),
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
const specRetryOptions = resolveElectronE2eSpecRetryOptions({
	packaged: usePackaged,
});

/** Excluded from the package tsconfig; loaded by @wdio/cli at runtime. */
export const config = {
	runner: "local",
	// Resolve from apps/desktop so monorepo root cwd does not matter.
	rootDir: packageRoot,
	// Optional escape hatch for repairing or isolating WebDriver downloads
	// without mutating the machine-wide temporary cache.
	cacheDir: process.env.WEBDRIVER_CACHE_DIR,
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
	// The upstream CDP bridge can transiently lose its initialization promise in
	// a packaged process. A spec retry creates a fresh Electron session;
	// all assertions remain strict and a second failure still fails the run.
	...specRetryOptions,
	services: [
		[
			"electron",
			resolveElectronE2eServiceOptions(),
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
		const fixture = await startUpdateFeedFixture({
			version: packageVersion,
			downloadable: process.platform === "linux",
			// Keep the checking phase observable instead of racing a loopback response.
			metadataDelayMs: 1_000,
		});
		updateFeedServer = fixture.server;
		process.env.VETTA_E2E_UPDATE_URL = fixture.url;
		console.log(`[wdio] packaged E2E update feed: ${fixture.url}`);
	},
	onComplete: () => {
		updateFeedServer?.close();
		updateFeedServer = undefined;
		if (stagedAppImageRoot) rmSync(stagedAppImageRoot, { recursive: true, force: true });
		stagedAppImageRoot = undefined;
	},
};
