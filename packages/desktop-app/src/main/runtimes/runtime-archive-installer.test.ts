import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installRuntimeArchive, installRuntimeDirectory } from "./runtime-archive-installer";

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

describe("installRuntimeDirectory", () => {
	it("copies a bundled runtime directory over the target", async () => {
		const sourceDirectory = join(testRoot, "vendor", "python");
		await mkdir(join(sourceDirectory, "bin"), { recursive: true });
		await writeFile(join(sourceDirectory, "bin", "python3.13"), "bundled-runtime", "utf8");

		const targetDirectory = join(testRoot, "managed", "3.13.12");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "stale"), "stale", "utf8");

		await installRuntimeDirectory({ sourceDirectory, targetDirectory });

		await expect(readFile(join(targetDirectory, "bin", "python3.13"), "utf8")).resolves.toBe("bundled-runtime");
		await expect(readFile(join(targetDirectory, "stale"), "utf8")).rejects.toThrow();
		await expect(readdir(join(testRoot, "managed"))).resolves.toEqual(["3.13.12"]);
	});

	// python-build-standalone 与 Node 官方包都用符号链接（python3 -> python3.13），
	// 解引用会让运行时体积翻倍，可执行位丢失则 seed 出来的运行时直接不可用。
	it.runIf(process.platform !== "win32")("preserves symlinks and the executable bit", async () => {
		const sourceDirectory = join(testRoot, "vendor", "python");
		await mkdir(join(sourceDirectory, "bin"), { recursive: true });
		const realBinary = join(sourceDirectory, "bin", "python3.13");
		await writeFile(realBinary, "bundled-runtime", "utf8");
		await chmod(realBinary, 0o755);
		await symlink("python3.13", join(sourceDirectory, "bin", "python3"));

		const targetDirectory = join(testRoot, "managed", "3.13.12");
		await installRuntimeDirectory({ sourceDirectory, targetDirectory });

		const copiedLink = join(targetDirectory, "bin", "python3");
		await expect(lstat(copiedLink).then((info) => info.isSymbolicLink())).resolves.toBe(true);
		await expect(readlink(copiedLink)).resolves.toBe("python3.13");
		const mode = (await lstat(join(targetDirectory, "bin", "python3.13"))).mode & 0o777;
		expect(mode & 0o111).not.toBe(0);
	});

	it("preserves an existing runtime when the source is missing", async () => {
		const targetDirectory = join(testRoot, "managed", "3.13.12");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "python3"), "existing-runtime", "utf8");

		await expect(
			installRuntimeDirectory({ sourceDirectory: join(testRoot, "vendor", "absent"), targetDirectory }),
		).rejects.toThrow();

		await expect(readFile(join(targetDirectory, "python3"), "utf8")).resolves.toBe("existing-runtime");
	});
});
