import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeAppUpdateConfig, writeInnoVerificationManifest } from "./build-inno-installer.mjs";
import { resolveUpdatePublishConfig } from "./resolve-update-publish-config.mjs";

test("writes updater config into the version directory installed by Inno", async () => {
	const sourceDir = await mkdtemp(join(tmpdir(), "vetta-inno-test-"));
	const version = "0.5.42";
	const resourcesDir = join(sourceDir, "versions", version, "resources");
	await mkdir(resourcesDir, { recursive: true });

	try {
		const publishConfig = resolveUpdatePublishConfig({
			VETTA_UPDATE_PROVIDER: "generic",
			VETTA_UPDATE_URL: "https://releases.openvetta.com/desktop/test",
		});
		assert.ok(publishConfig);
		await writeAppUpdateConfig(sourceDir, version, publishConfig);

		const config = await readFile(join(resourcesDir, "app-update.yml"), "utf8");
		assert.match(config, /provider: generic/);
		assert.match(config, /url: https:\/\/releases\.openvetta\.com\/desktop\/test/);
		assert.match(config, /useMultipleRangeRequest: true/);
		assert.match(config, /updaterCacheDirName: vetta-updater/);
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
	}
});

test("writes a stable versioned file manifest for pre-publish verification", async () => {
	const sourceDir = await mkdtemp(join(tmpdir(), "vetta-inno-test-"));
	const manifestPath = join(sourceDir, "installer.files.json");
	const versionDir = join(sourceDir, "version");
	await mkdir(join(versionDir, "resources"), { recursive: true });
	await Promise.all([
		writeFile(join(versionDir, "Vetta.exe"), "exe"),
		writeFile(join(versionDir, "resources", "app.asar"), "asar"),
	]);

	try {
		await writeInnoVerificationManifest(versionDir, manifestPath, "1.2.3");
		assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), {
			version: "1.2.3",
			files: [
				{ path: "resources/app.asar", size: 4 },
				{ path: "Vetta.exe", size: 3 },
			],
		});
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
	}
});
