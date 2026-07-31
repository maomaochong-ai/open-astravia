import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installRuntimeArchive } from "./runtime-archive-installer";

let testRoot = "";

beforeEach(async () => {
	testRoot = await mkdtemp(join(tmpdir(), "vetta-runtime-archive-"));
});

afterEach(async () => {
	await rm(testRoot, { recursive: true, force: true });
});

describe("installRuntimeArchive", () => {
	it("extracts a complete runtime before replacing the target directory", async () => {
		const sourceRoot = join(testRoot, "source");
		const sourceRuntime = join(sourceRoot, "runtime", "bin");
		await mkdir(sourceRuntime, { recursive: true });
		await writeFile(join(sourceRuntime, "tool"), "new-runtime", "utf8");

		const archivePath = join(testRoot, "runtime.tar.gz");
		const archive = spawnSync("tar", ["-czf", archivePath, "-C", sourceRoot, "runtime"], {
			encoding: "utf8",
		});
		expect(archive.status, archive.stderr || archive.stdout).toBe(0);

		const targetDirectory = join(testRoot, "managed", "22.22.2");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "stale"), "stale", "utf8");

		await installRuntimeArchive({
			archivePath,
			archiveType: "tar.gz",
			innerDirectory: "runtime",
			targetDirectory,
		});

		await expect(readFile(join(targetDirectory, "bin", "tool"), "utf8")).resolves.toBe("new-runtime");
		await expect(readFile(join(targetDirectory, "stale"), "utf8")).rejects.toThrow();
		await expect(readdir(join(testRoot, "managed"))).resolves.toEqual(["22.22.2"]);
	});

	it.runIf(process.platform === "win32")("extracts the Node ZIP format used by Windows releases", async () => {
		const sourceRoot = join(testRoot, "source");
		const sourceRuntime = join(sourceRoot, "node-v22.22.2-win-x64");
		await mkdir(sourceRuntime, { recursive: true });
		await writeFile(join(sourceRuntime, "node.exe"), "node-runtime", "utf8");

		const archivePath = join(testRoot, "node.zip");
		const archive = spawnSync("tar", ["-a", "-cf", archivePath, "-C", sourceRoot, "node-v22.22.2-win-x64"], {
			encoding: "utf8",
		});
		expect(archive.status, archive.stderr || archive.stdout).toBe(0);

		const targetDirectory = join(testRoot, "managed", "22.22.2");
		await installRuntimeArchive({
			archivePath,
			archiveType: "zip",
			innerDirectory: "node-v22.22.2-win-x64",
			targetDirectory,
		});

		await expect(readFile(join(targetDirectory, "node.exe"), "utf8")).resolves.toBe("node-runtime");
	});

	it("preserves an existing runtime when extraction fails", async () => {
		const targetDirectory = join(testRoot, "managed", "3.13.12");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "python.exe"), "existing-runtime", "utf8");
		const archivePath = join(testRoot, "broken.tar.gz");
		await writeFile(archivePath, "not an archive", "utf8");

		await expect(
			installRuntimeArchive({
				archivePath,
				archiveType: "tar.gz",
				innerDirectory: "python",
				targetDirectory,
			}),
		).rejects.toThrow("extract failed");

		await expect(readFile(join(targetDirectory, "python.exe"), "utf8")).resolves.toBe("existing-runtime");
		await expect(readdir(join(testRoot, "managed"))).resolves.toEqual(["3.13.12"]);
	});
});
