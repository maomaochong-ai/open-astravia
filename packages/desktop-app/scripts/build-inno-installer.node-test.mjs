import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeAppUpdateConfig } from "./build-inno-installer.mjs";

test("writes updater config into the version directory installed by Inno", async () => {
	const sourceDir = await mkdtemp(join(tmpdir(), "vetta-inno-test-"));
	const version = "0.5.42";
	const resourcesDir = join(sourceDir, "versions", version, "resources");
	await mkdir(resourcesDir, { recursive: true });

	try {
		await writeAppUpdateConfig(sourceDir, version, {
			provider: "generic",
			url: "https://releases.openvetta.com/desktop/test",
		});

		const config = await readFile(join(resourcesDir, "app-update.yml"), "utf8");
		assert.match(config, /provider: generic/);
		assert.match(config, /url: https:\/\/releases\.openvetta\.com\/desktop\/test/);
		assert.match(config, /updaterCacheDirName: vetta-updater/);
	} finally {
		await rm(sourceDir, { recursive: true, force: true });
	}
});
