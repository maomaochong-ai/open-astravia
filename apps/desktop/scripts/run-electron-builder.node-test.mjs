import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { LINUX_PACKAGE_METADATA, LINUX_RELEASE_TARGETS } from "./linux-packaging-contract.mjs";
import {
	resolveDefaultTargets,
	resolveElectronBuilderPublishMode,
	resolveElectronBuilderTargets,
} from "./run-electron-builder.js";
import { WINDOWS_RELEASE_TARGETS } from "./windows-packaging-contract.mjs";

test("Linux release builds AppImage, Debian, and RPM artifacts together", () => {
	assert.deepEqual(resolveDefaultTargets("linux"), LINUX_RELEASE_TARGETS);
	assert.notEqual(resolveDefaultTargets("linux"), LINUX_RELEASE_TARGETS);
	assert.match(LINUX_PACKAGE_METADATA.author.email, /@/);
	assert.match(LINUX_PACKAGE_METADATA.maintainer, /<.+@.+>/);
	assert.match(LINUX_PACKAGE_METADATA.homepage, /^https:\/\//);
});

test("electron-builder never publishes unless the caller explicitly opts in", () => {
	assert.equal(resolveElectronBuilderPublishMode(undefined), "never");
	assert.equal(resolveElectronBuilderPublishMode("always"), "always");
});

test("Windows release builds Inno, MSI, and ZIP without exposing Inno to electron-builder", () => {
	assert.deepEqual(resolveDefaultTargets("win"), WINDOWS_RELEASE_TARGETS);
	assert.deepEqual(resolveElectronBuilderTargets("win", WINDOWS_RELEASE_TARGETS), {
		targets: ["dir", "msi", "zip"],
		usesInno: true,
	});
	assert.throws(
		() => resolveElectronBuilderTargets("linux", ["inno"]),
		/The inno target requires a Windows build/,
	);
});

test("package scripts can build every Linux format independently", async () => {
	const packageJson = JSON.parse(await readFile(join(import.meta.dirname, "../package.json"), "utf8"));
	const scripts = packageJson.scripts;
	const expectedTargets = {
		"package:linux:appimage": "AppImage",
		"package:linux:deb": "deb",
		"package:linux:rpm": "rpm",
		"package:linux:tar.gz": "tar.gz",
	};

	assert.match(scripts["package:linux"], /--platform linux$/);
	assert.equal(scripts["dist:linux"], "bun run package:linux");
	assert.equal(scripts["package:linux:test"], "cross-env VETTA_BUILD_ENV=test bun run package:linux");
	for (const [scriptName, target] of Object.entries(expectedTargets)) {
		assert.match(scripts[scriptName], new RegExp(`--platform linux --target ${target}$`));
		assert.equal(scripts[`dist:${scriptName.slice("package:".length)}`], `bun run ${scriptName}`);
		assert.equal(
			scripts[`${scriptName}:test`],
			`cross-env VETTA_BUILD_ENV=test bun run ${scriptName}`,
		);
	}
});

test("package scripts can build every Windows format independently", async () => {
	const packageJson = JSON.parse(await readFile(join(import.meta.dirname, "../package.json"), "utf8"));
	const scripts = packageJson.scripts;
	const expectedTargets = {
		"package:win:inno": "inno",
		"package:win:msi": "msi",
		"package:win:portable": "portable",
		"package:win:zip": "zip",
	};

	assert.match(scripts["package:win"], /--platform win$/);
	assert.equal(scripts["dist:win"], "bun run package:win");
	assert.equal(scripts["package:win:test"], "cross-env VETTA_BUILD_ENV=test bun run package:win");
	for (const [scriptName, target] of Object.entries(expectedTargets)) {
		assert.match(scripts[scriptName], new RegExp(`--platform win --target ${target}$`));
		assert.equal(scripts[`dist:${scriptName.slice("package:".length)}`], `bun run ${scriptName}`);
		assert.equal(
			scripts[`${scriptName}:test`],
			`cross-env VETTA_BUILD_ENV=test bun run ${scriptName}`,
		);
	}
	assert.equal(scripts["dist:win:test"], "bun run package:win:test");
});
