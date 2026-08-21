import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactMatches, baselineArtifactName, compareVersions, metadataFile } from "./desktop-upgrade-e2e.mjs";

test("selects the platform metadata used by electron-updater", () => {
	const expected = process.platform === "win32" ? "latest.yml" : process.platform === "darwin" ? "latest-mac.yml" : "latest-linux.yml";
	assert.equal(metadataFile(), expected);
});

test("compares semantic desktop versions", () => {
	assert.equal(compareVersions("0.5.47", "0.5.46") > 0, true);
	assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
	assert.equal(compareVersions("1.0.0", "1.1.0") < 0, true);
});

test("uses stable release artifact names for baseline installation", () => {
	const stableArtifactPattern = /^Vetta-0\.5\.46(?:-win-x64\.exe|-mac\.zip|-arm64-mac\.zip|\.AppImage)$/;
	for (const artifactName of [
		"Vetta-0.5.46-win-x64.exe",
		"Vetta-0.5.46-mac.zip",
		"Vetta-0.5.46-arm64-mac.zip",
		"Vetta-0.5.46.AppImage",
	]) {
		assert.match(artifactName, stableArtifactPattern);
	}

	const name = baselineArtifactName("0.5.46");
	assert.match(name, stableArtifactPattern);
	assert.equal(artifactMatches(name), true);
});
