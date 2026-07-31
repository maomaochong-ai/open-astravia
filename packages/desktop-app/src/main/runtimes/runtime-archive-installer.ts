import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface RuntimeArchiveInstallOptions {
	archivePath: string;
	archiveType: "tar.gz" | "zip";
	innerDirectory: string;
	targetDirectory: string;
}

function extractArchive(archivePath: string, destination: string, archiveType: string): void {
	// Windows 10+ 的 bsdtar 与 Unix tar 都支持项目使用的 tar.gz；Windows
	// bsdtar 同时支持 Node 官方发布的 zip。
	const result = spawnSync("tar", ["-xf", archivePath, "-C", destination], {
		encoding: "utf-8",
		timeout: 180_000,
	});
	if (result.status !== 0) {
		throw new Error(
			`${archiveType} extract failed: ${result.stderr || result.stdout || result.error?.message || "unknown error"}`,
		);
	}
}

export async function installRuntimeArchive(options: RuntimeArchiveInstallOptions): Promise<void> {
	const targetParent = dirname(options.targetDirectory);
	await mkdir(targetParent, { recursive: true });
	const stagingDirectory = await mkdtemp(join(targetParent, `.${basename(options.targetDirectory)}-extract-`));

	try {
		extractArchive(options.archivePath, stagingDirectory, options.archiveType);
		const extractedDirectory = join(stagingDirectory, options.innerDirectory);
		const extractedInfo = await stat(extractedDirectory).catch(() => undefined);
		if (!extractedInfo?.isDirectory()) {
			throw new Error(`runtime archive is missing directory: ${options.innerDirectory}`);
		}

		// 先完整解压并验证目录，再替换目标。损坏归档不会破坏现有运行时。
		await rm(options.targetDirectory, { recursive: true, force: true });
		await rename(extractedDirectory, options.targetDirectory);
	} finally {
		if (existsSync(stagingDirectory)) {
			await rm(stagingDirectory, { recursive: true, force: true });
		}
	}
}
