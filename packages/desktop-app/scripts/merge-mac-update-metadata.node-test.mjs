import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { parse, stringify } from "yaml";
import { mergeMacUpdateMetadata } from "./merge-mac-update-metadata.mjs";

const temporaryRoots = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function metadata(version, fileName) {
	return stringify({
		version,
		files: [{ url: fileName, sha512: `${fileName}-hash`, size: 10 }],
		path: fileName,
		sha512: `${fileName}-hash`,
		releaseDate: "2026-07-31T00:00:00.000Z",
	});
}

async function createReleaseDir({ arm64Version = "1.2.3", x64Version = "1.2.3" } = {}) {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-mac-merge-test-"));
	temporaryRoots.push(releaseDir);
	await writeFile(join(releaseDir, "latest-mac-arm64.yml"), metadata(arm64Version, "Vetta-1.2.3-arm64-mac.zip"));
	await writeFile(join(releaseDir, "latest-mac-x64.yml"), metadata(x64Version, "Vetta-1.2.3-mac.zip"));
	return releaseDir;
}

test("merges per-architecture metadata into a single latest-mac.yml", async () => {
	const releaseDir = await createReleaseDir();

	const merged = await mergeMacUpdateMetadata({ releaseDir });

	assert.equal(merged.version, "1.2.3");
	assert.deepEqual(
		merged.files.map((file) => file.url),
		["Vetta-1.2.3-mac.zip", "Vetta-1.2.3-arm64-mac.zip"],
	);
	assert.equal(merged.path, "Vetta-1.2.3-mac.zip");
	const written = parse(await readFile(join(releaseDir, "latest-mac.yml"), "utf8"));
	assert.equal(written.files.length, 2);
	const remaining = await readdir(releaseDir);
	assert.deepEqual(remaining, ["latest-mac.yml"]);
});

test("rejects metadata built from different versions", async () => {
	const releaseDir = await createReleaseDir({ x64Version: "1.2.4" });
	await assert.rejects(mergeMacUpdateMetadata({ releaseDir }), /version mismatch/);
});

test("does nothing when no per-architecture metadata exists", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-mac-merge-test-"));
	temporaryRoots.push(releaseDir);
	assert.equal(await mergeMacUpdateMetadata({ releaseDir }), null);
});
