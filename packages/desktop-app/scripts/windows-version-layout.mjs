import { execFileSync } from "node:child_process";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
// builder-util Arch enum: ia32=0, x64=1, arm64=3.
const ELECTRON_ARCH_BY_BUILDER_ARCH = {
	0: "ia32",
	1: "x64",
	3: "arm64",
};
const GO_ARCH_BY_ELECTRON_ARCH = {
	arm64: "arm64",
	ia32: "386",
	x64: "amd64",
};

async function renameWithRetry(source, destination) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			await rename(source, destination);
			return;
		} catch (error) {
			if (!["EBUSY", "EPERM"].includes(error?.code) || attempt >= 59) throw error;
			await setTimeout(500);
		}
	}
}

export function validateLayoutVersion(version) {
	if (!VERSION_PATTERN.test(version) || version === "." || version === "..") {
		throw new Error(`[windows-version-layout] invalid version: ${version}`);
	}
	return version;
}

export async function createWindowsVersionLayout(appOutDir, version, launcherPath) {
	validateLayoutVersion(version);
	const entries = await readdir(appOutDir);
	const versionsDir = join(appOutDir, "versions");
	const versionDir = join(versionsDir, version);
	await mkdir(versionDir, { recursive: true });

	for (const entry of entries) {
		if (entry === "versions" || entry === "VettaLauncher.exe") continue;
		await renameWithRetry(join(appOutDir, entry), join(versionDir, entry));
	}
	await renameWithRetry(launcherPath, join(appOutDir, "Vetta.exe"));
	// NSIS adds elevate.exe after afterPack, so its destination directory must
	// remain present even though the Electron resources live under versions/.
	await mkdir(join(appOutDir, "resources"), { recursive: true });
	await writeFile(join(appOutDir, "current.json"), `${JSON.stringify({ version })}\n`, "utf8");
}

export function buildWindowsLauncher({ arch, outputPath, sourceDir }) {
	const goArch = GO_ARCH_BY_ELECTRON_ARCH[arch];
	if (!goArch) throw new Error(`[windows-version-layout] unsupported architecture: ${arch}`);
	execFileSync(process.platform === "win32" ? "go.exe" : "go", [
		"build",
		"-trimpath",
		"-ldflags",
		"-H=windowsgui -s -w",
		"-o",
		outputPath,
		"main.go",
	], {
		cwd: sourceDir,
		env: {
			...process.env,
			CGO_ENABLED: "0",
			GOARCH: goArch,
			GOOS: "windows",
		},
		stdio: "inherit",
	});
}

export default async function windowsVersionLayout(context) {
	if (context.electronPlatformName !== "win32") return;
	const version = validateLayoutVersion(context.packager.appInfo.version);
	const arch = ELECTRON_ARCH_BY_BUILDER_ARCH[context.arch];
	if (!arch) throw new Error(`[windows-version-layout] unsupported builder architecture: ${context.arch}`);
	const launcherPath = join(context.appOutDir, "VettaLauncher.exe");
	const sourceDir = join(import.meta.dirname, "..", "native", "windows-launcher");
	buildWindowsLauncher({ arch, outputPath: launcherPath, sourceDir });
	await createWindowsVersionLayout(context.appOutDir, version, launcherPath);
	console.log(`[windows-version-layout] staged version ${version} (${arch})`);
}
