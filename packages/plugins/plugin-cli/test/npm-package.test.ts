import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { c as createTar } from "tar";
import { resolveNpmPluginArchive } from "../src/npm-package.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createPackageTarball(): Promise<string> {
	const fixtureRoot = await mkdtemp(join(tmpdir(), "vetta-plugin-cli-fixture-"));
	temporaryDirectories.push(fixtureRoot);
	await mkdir(join(fixtureRoot, "package", "release"), { recursive: true });
	await writeFile(
		join(fixtureRoot, "package", "package.json"),
		JSON.stringify({
			name: "@example/demo",
			version: "1.2.0",
			vetta: {
				schemaVersion: 1,
				type: "desktop-plugin",
				pluginId: "demo",
				archive: "release/vetta-plugin.zip",
			},
		}),
	);
	await writeFile(join(fixtureRoot, "package", "release", "vetta-plugin.zip"), "zip-fixture");
	const tarball = join(fixtureRoot, "package.tgz");
	await createTar({ cwd: fixtureRoot, file: tarball, gzip: true }, ["package"]);
	return tarball;
}

describe("resolveNpmPluginArchive", () => {
	it("extracts only the declared plugin archive from a registry package", async () => {
		const fixture = await createPackageTarball();
		const pack = vi.fn(async (_spec: string, destination: string) => {
			await copyFile(fixture, join(destination, "example-demo-1.2.0.tgz"));
			return { filename: "example-demo-1.2.0.tgz", integrity: "sha512-fixture" };
		});

		const result = await resolveNpmPluginArchive("@example/demo@1.2.0", pack);
		expect(result.packageManifest.vetta.pluginId).toBe("demo");
		expect(result.expectedSha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(result.integrity).toBe("sha512-fixture");
		await result.cleanup();
	});

	it("rejects non-registry package specs before invoking npm", async () => {
		const pack = vi.fn();
		await expect(resolveNpmPluginArchive("git+https://example.com/demo.git", pack)).rejects.toThrow(
			"npm registry package",
		);
		expect(pack).not.toHaveBeenCalled();
	});
});
