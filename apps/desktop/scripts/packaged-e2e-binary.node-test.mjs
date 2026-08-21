import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolvePackagedE2eBinaryPath } from "./packaged-e2e-binary.mjs";

test("Windows packaged E2E drives the versioned Electron binary instead of the detached launcher", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const unpackedRoot = join(packageRoot, "release", "win-unpacked");
	const versionedBinary = join(unpackedRoot, "versions", "1.2.3", "Vetta.exe");
	await mkdir(join(unpackedRoot, "versions", "1.2.3"), { recursive: true });
	await Promise.all([
		writeFile(join(unpackedRoot, "Vetta.exe"), "launcher"),
		writeFile(join(unpackedRoot, "current.json"), '{"version":"1.2.3"}\n'),
		writeFile(versionedBinary, "electron"),
	]);

	try {
		assert.equal(resolvePackagedE2eBinaryPath(packageRoot, "win32"), versionedBinary);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});

test("Windows packaged E2E rejects an unsafe version pointer", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const unpackedRoot = join(packageRoot, "release", "win-unpacked");
	await mkdir(unpackedRoot, { recursive: true });
	await writeFile(join(unpackedRoot, "current.json"), '{"version":"../escape"}\n');

	try {
		assert.throws(() => resolvePackagedE2eBinaryPath(packageRoot, "win32"), /invalid version pointer/);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});
