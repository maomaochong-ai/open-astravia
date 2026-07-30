import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	collectArtifacts,
	readReleaseVersion,
	validatePublishTarget,
} from "./publish-update-artifacts-r2.mjs";

test("collectArtifacts uploads only files referenced by updater metadata and publishes metadata last", async () => {
	const directory = await mkdtemp(join(tmpdir(), "vetta-r2-publish-"));
	try {
		await Promise.all([
			writeFile(
				join(directory, "latest.yml"),
				"version: 1.2.3\nfiles:\n  - url: Vetta%20Setup%201.2.3.exe\npath: Vetta Setup 1.2.3.exe\n",
			),
			writeFile(join(directory, "Vetta Setup 1.2.3.exe"), "installer"),
			writeFile(join(directory, "Vetta Setup 1.2.3.exe.blockmap"), "blockmap"),
			writeFile(join(directory, "Vetta Setup 1.2.2.exe"), "stale"),
		]);

		assert.deepEqual(await collectArtifacts(directory), [
			"Vetta Setup 1.2.3.exe",
			"Vetta Setup 1.2.3.exe.blockmap",
			"latest.yml",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("collectArtifacts rejects metadata that points to a missing artifact", async () => {
	const directory = await mkdtemp(join(tmpdir(), "vetta-r2-publish-"));
	try {
		await writeFile(join(directory, "latest-linux-arm64.yml"), "version: 1.2.3\npath: Vetta-1.2.3.AppImage\n");
		await assert.rejects(() => collectArtifacts(directory), /references missing artifact/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("readReleaseVersion requires all updater metadata to use one valid version", async () => {
	const directory = await mkdtemp(join(tmpdir(), "vetta-r2-publish-"));
	try {
		await Promise.all([
			writeFile(join(directory, "latest.yml"), "version: 1.2.3\n"),
			writeFile(join(directory, "latest-mac.yml"), "version: 1.2.4\n"),
		]);
		await assert.rejects(() => readReleaseVersion(directory), /exactly one version/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("validatePublishTarget requires URL and R2 prefixes to match", () => {
	assert.throws(
		() =>
			validatePublishTarget({
				prefix: "desktop/test",
				updateUrl: "https://releases.example.com/desktop/stable",
				releaseVersion: "1.2.3",
				packageVersion: "1.2.3",
			}),
		/does not match/,
	);
});

test("validatePublishTarget rejects QA versions on stable and allows test", () => {
	assert.throws(
		() =>
			validatePublishTarget({
				prefix: "desktop/stable",
				updateUrl: "https://releases.example.com/desktop/stable",
				releaseVersion: "1.2.4",
				packageVersion: "1.2.3",
			}),
		/refusing QA version/,
	);
	assert.doesNotThrow(() =>
		validatePublishTarget({
			prefix: "desktop/test",
			updateUrl: "https://releases.example.com/desktop/test",
			releaseVersion: "1.2.4",
			packageVersion: "1.2.3",
		}),
	);
	assert.doesNotThrow(() =>
		validatePublishTarget({
			prefix: "desktop/stable",
			updateUrl: "https://releases.example.com/desktop/stable",
			releaseVersion: "1.2.4",
			packageVersion: "1.2.3",
			allowQaStable: true,
		}),
	);
});
