import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { windowsSupplementalArtifactNames } from "./windows-packaging-contract.mjs";
import {
	readExpectedWindowsVersion,
	verifyExtractedWindowsLayout,
} from "./verify-windows-packages.mjs";

async function createLayout(root, version) {
	const versionDir = join(root, "versions", version);
	await mkdir(join(versionDir, "resources"), { recursive: true });
	await Promise.all([
		writeFile(join(root, "Vetta.exe"), "launcher"),
		writeFile(join(root, "current.json"), `${JSON.stringify({ version })}\n`),
		writeFile(join(versionDir, "Vetta.exe"), "application"),
		writeFile(join(versionDir, "resources", "app.asar"), "archive"),
	]);
}

test("Windows supplemental package names are stable and versioned", () => {
	assert.deepEqual(windowsSupplementalArtifactNames("1.2.3"), [
		"Vetta-1.2.3-win-x64.msi",
		"Vetta-1.2.3-win-x64.zip",
	]);
});

test("Windows package inspection accepts the versioned launcher layout at any extraction depth", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-windows-package-layout-"));
	try {
		const layoutRoot = join(root, "Program Files", "Vetta");
		await createLayout(layoutRoot, "1.2.3");
		assert.equal(await verifyExtractedWindowsLayout(root, "1.2.3"), layoutRoot);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Windows package inspection rejects an incomplete or wrong-version layout", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-windows-package-layout-"));
	try {
		await createLayout(root, "1.2.2");
		await assert.rejects(
			() => verifyExtractedWindowsLayout(root, "1.2.3"),
			/expected one complete 1\.2\.3 layout/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Windows package verification uses the Inno update manifest version", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-windows-packages-"));
	try {
		await writeFile(join(releaseDir, "latest.yml"), "version: 9.8.7\n");
		assert.equal(await readExpectedWindowsVersion(releaseDir), "9.8.7");
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});
