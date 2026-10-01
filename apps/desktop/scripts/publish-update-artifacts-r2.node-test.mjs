import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	assertNotDowngrade,
	collectArtifacts,
	contentTypeFor,
	readReleaseVersion,
	validatePublishTarget,
	verifyRemoteMetadataVersions,
} from "./publish-update-artifacts-r2.mjs";

test("contentTypeFor publishes native package formats with package media types", () => {
	assert.equal(contentTypeFor("astravia_1.2.3_amd64.deb"), "application/vnd.debian.binary-package");
	assert.equal(contentTypeFor("astravia-1.2.3.x86_64.rpm"), "application/x-rpm");
	assert.equal(contentTypeFor("Astravia-1.2.3-win-x64.msi"), "application/x-msi");
});

test("collectArtifacts uploads updater files and matching Windows supplements before metadata", async () => {
	const directory = await mkdtemp(join(tmpdir(), "astravia-r2-publish-"));
	try {
		await Promise.all([
			writeFile(
				join(directory, "latest.yml"),
				"version: 1.2.3\nfiles:\n  - url: Astravia%20Setup%201.2.3.exe\npath: Astravia Setup 1.2.3.exe\n",
			),
			writeFile(join(directory, "Astravia Setup 1.2.3.exe"), "installer"),
			writeFile(join(directory, "Astravia Setup 1.2.3.exe.blockmap"), "blockmap"),
			writeFile(join(directory, "Astravia-1.2.3-win-x64.msi"), "msi"),
			writeFile(join(directory, "Astravia-1.2.3-win-x64.zip"), "zip"),
			writeFile(join(directory, "Astravia Setup 1.2.2.exe"), "stale"),
			writeFile(join(directory, "Astravia-1.2.2-win-x64.msi"), "stale"),
		]);

		assert.deepEqual(await collectArtifacts(directory), [
			"Astravia Setup 1.2.3.exe",
			"Astravia Setup 1.2.3.exe.blockmap",
			"Astravia-1.2.3-win-x64.msi",
			"Astravia-1.2.3-win-x64.zip",
			"latest.yml",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("collectArtifacts uploads the deb and rpm packages listed in Linux metadata", async () => {
	const directory = await mkdtemp(join(tmpdir(), "astravia-r2-publish-"));
	try {
		await Promise.all([
			writeFile(
				join(directory, "latest-linux.yml"),
				[
					"version: 1.2.3",
					"files:",
					"  - url: Astravia-1.2.3.AppImage",
					"  - url: astravia_1.2.3_amd64.deb",
					"  - url: astravia-1.2.3.x86_64.rpm",
					"path: Astravia-1.2.3.AppImage",
					"",
				].join("\n"),
			),
			writeFile(join(directory, "Astravia-1.2.3.AppImage"), "appimage"),
			writeFile(join(directory, "astravia_1.2.3_amd64.deb"), "deb"),
			writeFile(join(directory, "astravia-1.2.3.x86_64.rpm"), "rpm"),
		]);

		assert.deepEqual(await collectArtifacts(directory), [
			"Astravia-1.2.3.AppImage",
			"astravia-1.2.3.x86_64.rpm",
			"astravia_1.2.3_amd64.deb",
			"latest-linux.yml",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("collectArtifacts rejects metadata that points to a missing artifact", async () => {
	const directory = await mkdtemp(join(tmpdir(), "astravia-r2-publish-"));
	try {
		await writeFile(join(directory, "latest-linux-arm64.yml"), "version: 1.2.3\npath: Astravia-1.2.3.AppImage\n");
		await assert.rejects(() => collectArtifacts(directory), /references missing artifact/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("readReleaseVersion requires all updater metadata to use one valid version", async () => {
	const directory = await mkdtemp(join(tmpdir(), "astravia-r2-publish-"));
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
});

test("assertNotDowngrade allows equal/newer releases and rejects older releases", () => {
	assert.doesNotThrow(() =>
		assertNotDowngrade({
			releaseVersion: "1.2.3",
			remoteVersion: "1.2.3",
			metadataFile: "latest.yml",
		}),
	);
	assert.doesNotThrow(() =>
		assertNotDowngrade({
			releaseVersion: "1.3.0",
			remoteVersion: "1.2.99",
			metadataFile: "latest.yml",
		}),
	);
	assert.throws(
		() =>
			assertNotDowngrade({
				releaseVersion: "1.2.3",
				remoteVersion: "1.2.4",
				metadataFile: "latest.yml",
			}),
		/refusing to downgrade/,
	);
});

test("verifyRemoteMetadataVersions accepts missing metadata and rejects a newer remote channel", async () => {
	const responses = new Map([
		["latest.yml", new Response("not found", { status: 404 })],
		["latest-mac.yml", new Response("version: 2.0.0\n", { status: 200 })],
	]);
	const fetchImpl = async (url) => responses.get(new URL(url).pathname.split("/").at(-1));

	await assert.rejects(
		() =>
			verifyRemoteMetadataVersions({
				updateUrl: "https://releases.example.com/desktop/stable",
				metadataFiles: ["latest.yml", "latest-mac.yml"],
				releaseVersion: "1.9.9",
				fetchImpl,
			}),
		/refusing to downgrade latest-mac.yml from 2.0.0 to 1.9.9/,
	);
});
