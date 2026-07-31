import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { stringify } from "yaml";
import { verifyMacUpdate } from "./verify-mac-update.mjs";

const temporaryRoots = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture({ includeBlockmap = true, sha512 = undefined } = {}) {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-mac-update-test-"));
	temporaryRoots.push(releaseDir);
	const fileName = "Vetta-1.2.3-mac.zip";
	const content = Buffer.from("test update zip");
	const actualSha512 = createHash("sha512").update(content).digest("base64");
	await writeFile(join(releaseDir, fileName), content);
	if (includeBlockmap) await writeFile(join(releaseDir, `${fileName}.blockmap`), "blockmap");
	await writeFile(
		join(releaseDir, "latest-mac.yml"),
		stringify({
			version: "1.2.3",
			files: [{ url: fileName, sha512: sha512 ?? actualSha512, size: content.length }],
			path: fileName,
			sha512: sha512 ?? actualSha512,
		}),
	);
	return releaseDir;
}

test("verifies Mac update metadata, ZIP, hash, size, and blockmap", async () => {
	const releaseDir = await createFixture();
	const result = await verifyMacUpdate({ releaseDir, requireSignature: false });
	assert.equal(result.version, "1.2.3");
});

test("rejects a Mac update without a ZIP blockmap", async () => {
	const releaseDir = await createFixture({ includeBlockmap: false });
	await assert.rejects(
		verifyMacUpdate({ releaseDir, requireSignature: false }),
		/missing ZIP blockmap/,
	);
});

test("rejects a Mac update with a mismatched hash", async () => {
	const releaseDir = await createFixture({ sha512: "invalid" });
	await assert.rejects(
		verifyMacUpdate({ releaseDir, requireSignature: false }),
		/SHA-512 mismatch/,
	);
});
