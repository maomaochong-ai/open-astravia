import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWindowsVersionLayout, validateLayoutVersion } from "./windows-version-layout.mjs";

test("createWindowsVersionLayout keeps launcher, pointer, and NSIS compatibility directory at root", async () => {
	const directory = await mkdtemp(join(tmpdir(), "vetta-version-layout-"));
	await mkdir(join(directory, "resources"), { recursive: true });
	await writeFile(join(directory, "Vetta.exe"), "electron");
	await writeFile(join(directory, "resources", "app.asar"), "asar");
	const launcherPath = join(directory, "VettaLauncher.exe");
	await writeFile(launcherPath, "launcher");

	await createWindowsVersionLayout(directory, "1.2.3", launcherPath);

	assert.equal(await readFile(join(directory, "Vetta.exe"), "utf8"), "launcher");
	assert.equal(await readFile(join(directory, "versions", "1.2.3", "Vetta.exe"), "utf8"), "electron");
	assert.equal((await stat(join(directory, "resources"))).isDirectory(), true);
	assert.deepEqual(JSON.parse(await readFile(join(directory, "current.json"), "utf8")), { version: "1.2.3" });
});

test("validateLayoutVersion rejects path traversal", () => {
	assert.throws(() => validateLayoutVersion("../1.2.3"), /invalid version/);
	assert.equal(validateLayoutVersion("1.2.3-beta.1"), "1.2.3-beta.1");
});
