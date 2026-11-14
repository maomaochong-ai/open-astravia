import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { stringify } from "yaml";
import { retryTransientNetwork, verifyMacUpdate } from "./verify-mac-update.mjs";

const temporaryRoots = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture({ includeBlockmap = true, sha512 = undefined, version = "1.2.3" } = {}) {
	const releaseDir = await mkdtemp(join(tmpdir(), "astravia-mac-update-test-"));
	temporaryRoots.push(releaseDir);
	const fileName = `Astravia-${version}-mac.zip`;
	const content = Buffer.from("test update zip");
	const actualSha512 = createHash("sha512").update(content).digest("base64");
	await writeFile(join(releaseDir, fileName), content);
	if (includeBlockmap) await writeFile(join(releaseDir, `${fileName}.blockmap`), "blockmap");
	await writeFile(
		join(releaseDir, "latest-mac.yml"),
		stringify({
			version,
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

test("verifies a pre-release Mac update version", async () => {
	const releaseDir = await createFixture({ version: "1.2.3-4" });
	const result = await verifyMacUpdate({ releaseDir, requireSignature: false });
	assert.equal(result.version, "1.2.3-4");
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

const networkError = () =>
	Object.assign(new Error("Command failed: xcrun stapler validate"), {
		stdout: 'NSURLErrorDomain Code=-1005 "The network connection was lost."\nError 68.',
	});

test("retries a transient CloudKit network failure until it succeeds", async () => {
	let calls = 0;
	const result = await retryTransientNetwork(
		async () => {
			calls += 1;
			if (calls < 3) throw networkError();
			return "ok";
		},
		{ sleep: async () => {} },
	);
	assert.equal(result, "ok");
	assert.equal(calls, 3);
});

test("gives up after the allowed attempts on a persistent network failure", async () => {
	let calls = 0;
	await assert.rejects(
		retryTransientNetwork(
			async () => {
				calls += 1;
				throw networkError();
			},
			{ attempts: 3, sleep: async () => {} },
		),
		/stapler validate/,
	);
	assert.equal(calls, 3);
});

test("does not retry a genuine validation failure", async () => {
	let calls = 0;
	await assert.rejects(
		retryTransientNetwork(
			async () => {
				calls += 1;
				throw Object.assign(new Error("rejected"), { stdout: "The validate action failed! Error 65." });
			},
			{ sleep: async () => {} },
		),
		/rejected/,
	);
	assert.equal(calls, 1);
});
