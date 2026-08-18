import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { stringify } from "yaml";
import { verifyLinuxUpdates } from "./verify-linux-update.mjs";

test("verifyLinuxUpdates verifies AppImage size, hash, and embedded block map metadata", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-linux-update-"));
	try {
		const blockMap = deflateRawSync(Buffer.from(JSON.stringify({ version: "2", files: [] })));
		const blockMapSize = Buffer.allocUnsafe(4);
		blockMapSize.writeUInt32BE(blockMap.length);
		const artifact = Buffer.concat([Buffer.from("appimage"), blockMap, blockMapSize]);
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

test("verifyLinuxUpdates rejects metadata whose hash does not match the AppImage", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-linux-update-"));
	try {
		const blockMap = deflateRawSync(Buffer.from(JSON.stringify({ version: "2", files: [] })));
		const blockMapSize = Buffer.allocUnsafe(4);
		blockMapSize.writeUInt32BE(blockMap.length);
		const artifact = Buffer.concat([Buffer.from("appimage"), blockMap, blockMapSize]);
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
