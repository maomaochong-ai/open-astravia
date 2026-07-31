import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface RuntimeArchiveInstallOptions {
	archivePath: string;
	archiveType: "tar.gz" | "zip";
	innerDirectory: string;
	targetDirectory: string;
}

export interface RuntimeDirectoryInstallOptions {
	sourceDirectory: string;
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

/**
 * 先把运行时准备到同盘的 staging 目录，验证通过后再原子替换目标。
 * 准备过程失败不会破坏既有运行时。
 */
async function installViaStaging(
	targetDirectory: string,
	stagingPrefix: string,
	prepare: (stagingDirectory: string) => Promise<string>,
): Promise<void> {
	const targetParent = dirname(targetDirectory);
	await mkdir(targetParent, { recursive: true });
	const stagingDirectory = await mkdtemp(join(targetParent, `.${basename(targetDirectory)}-${stagingPrefix}-`));

	try {
		const preparedDirectory = await prepare(stagingDirectory);
		const preparedInfo = await stat(preparedDirectory).catch(() => undefined);
		if (!preparedInfo?.isDirectory()) {
			throw new Error(`runtime payload is missing directory: ${preparedDirectory}`);
		}

		await rm(targetDirectory, { recursive: true, force: true });
		await rename(preparedDirectory, targetDirectory);
	} finally {
		if (existsSync(stagingDirectory)) {
			await rm(stagingDirectory, { recursive: true, force: true });
		}
	}
}

export async function installRuntimeArchive(options: RuntimeArchiveInstallOptions): Promise<void> {
	await installViaStaging(options.targetDirectory, "extract", async (stagingDirectory) => {
		extractArchive(options.archivePath, stagingDirectory, options.archiveType);
		return join(stagingDirectory, options.innerDirectory);
	});
}

/**
 * 从已解压的内置目录安装（macOS 专用形态）。macOS 的 vendor 运行时必须以解压
 * 目录内置，归档里的 Mach-O 签不到名、过不了公证，详见 docs/desktop/macos-auto-update.md。
 * 复制保留符号链接与权限位，因此二进制上的代码签名不受影响。
 */
export async function installRuntimeDirectory(options: RuntimeDirectoryInstallOptions): Promise<void> {
	await installViaStaging(options.targetDirectory, "copy", async (stagingDirectory) => {
		const preparedDirectory = join(stagingDirectory, "payload");
		// verbatimSymlinks 不可省：默认会把相对链接（python3 -> python3.13）重写成
		// 指向源目录的绝对路径，安装后就指回了 app bundle 内部，更新替换 .app 时悬空。
		await cp(options.sourceDirectory, preparedDirectory, {
			recursive: true,
			preserveTimestamps: true,
			verbatimSymlinks: true,
		});
		return preparedDirectory;
	});
}
