import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { stringify } from "yaml";
import { LINUX_RELEASE_EXTENSIONS } from "./linux-packaging-contract.mjs";
import { verifyLinuxUpdates } from "./verify-linux-update.mjs";

function createAppImage() {
	const blockMap = deflateRawSync(Buffer.from(JSON.stringify({ version: "2", files: [] })));
	const blockMapSize = Buffer.allocUnsafe(4);
	blockMapSize.writeUInt32BE(blockMap.length);
	return { artifact: Buffer.concat([Buffer.from("appimage"), blockMap, blockMapSize]), blockMap };
}

test("verifyLinuxUpdates verifies AppImage size, hash, and embedded block map metadata", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-linux-update-"));
	try {
		const { artifact, blockMap } = createAppImage();
		const sha512 = createHash("sha512").update(artifact).digest("base64");
		await Promise.all([
			writeFile(join(releaseDir, "Vetta-1.2.3.AppImage"), artifact),
			writeFile(
				join(releaseDir, "latest-linux.yml"),
				stringify({
					version: "1.2.3",
					files: [
						{
							url: "Vetta-1.2.3.AppImage",
							sha512,
							size: artifact.length,
							blockMapSize: blockMap.length,
						},
					],
					path: "Vetta-1.2.3.AppImage",
					sha512,
				}),
			),
		]);

		assert.deepEqual(await verifyLinuxUpdates({ releaseDir }), {
			version: "1.2.3",
			metadataFiles: ["latest-linux.yml"],
		});
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});

test("verifyLinuxUpdates requires every Linux release format from one update manifest", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-linux-update-"));
	try {
		const { artifact: appImage, blockMap } = createAppImage();
		const deb = Buffer.from("deb-package");
		const rpm = Buffer.from("rpm-package");
		const files = [
			{
				url: "Vetta-1.2.3.AppImage",
				sha512: createHash("sha512").update(appImage).digest("base64"),
				size: appImage.length,
				blockMapSize: blockMap.length,
			},
			{
				url: "vetta_1.2.3_amd64.deb",
				sha512: createHash("sha512").update(deb).digest("base64"),
				size: deb.length,
			},
			{
				url: "vetta-1.2.3.x86_64.rpm",
				sha512: createHash("sha512").update(rpm).digest("base64"),
				size: rpm.length,
			},
		];
		await Promise.all([
			writeFile(join(releaseDir, files[0].url), appImage),
			writeFile(join(releaseDir, files[1].url), deb),
			writeFile(join(releaseDir, files[2].url), rpm),
			writeFile(
				join(releaseDir, "latest-linux.yml"),
				stringify({
					version: "1.2.3",
					files,
					path: files[0].url,
					sha512: files[0].sha512,
				}),
			),
		]);

		assert.deepEqual(
			await verifyLinuxUpdates({ releaseDir, requiredExtensions: LINUX_RELEASE_EXTENSIONS }),
			{
				version: "1.2.3",
				metadataFiles: ["latest-linux.yml"],
			},
		);
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});

test("verifyLinuxUpdates rejects a release manifest that omits a native Linux format", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-linux-update-"));
	try {
		const { artifact, blockMap } = createAppImage();
		const sha512 = createHash("sha512").update(artifact).digest("base64");
		await Promise.all([
			writeFile(join(releaseDir, "Vetta-1.2.3.AppImage"), artifact),
			writeFile(
				join(releaseDir, "latest-linux.yml"),
				stringify({
					version: "1.2.3",
					files: [
						{
							url: "Vetta-1.2.3.AppImage",
							sha512,
							size: artifact.length,
							blockMapSize: blockMap.length,
						},
					],
					path: "Vetta-1.2.3.AppImage",
					sha512,
				}),
			),
		]);

		await assert.rejects(
			() => verifyLinuxUpdates({ releaseDir, requiredExtensions: LINUX_RELEASE_EXTENSIONS }),
			/does not reference \.deb/,
		);
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});

test("verifyLinuxUpdates rejects metadata whose hash does not match the AppImage", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-linux-update-"));
	try {
		const { artifact, blockMap } = createAppImage();
		await Promise.all([
			writeFile(join(releaseDir, "Vetta-1.2.3.AppImage"), artifact),
			writeFile(
				join(releaseDir, "latest-linux.yml"),
				stringify({
					version: "1.2.3",
					files: [
						{
							url: "Vetta-1.2.3.AppImage",
							sha512: "invalid",
							size: artifact.length,
							blockMapSize: blockMap.length,
						},
					],
				}),
			),
		]);

		await assert.rejects(() => verifyLinuxUpdates({ releaseDir }), /SHA-512 mismatch/);
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});
