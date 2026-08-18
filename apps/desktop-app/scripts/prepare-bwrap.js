import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { chmod, copyFile, rename, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = join(import.meta.dirname, "..");
const runtimeCoreLinuxSandboxDir = join(projectRoot, "..", "..", "packages", "runtime-core", "sandbox", "linux");
const supportedArchs = new Set(["x64", "arm64"]);

const bubblewrapVersion = process.env.VETTA_BWRAP_VERSION?.trim() || "0.11.0";
const targetArchs = (process.env.VETTA_BWRAP_TARGET_ARCHS?.trim() || process.arch)
	.split(",")
	.map((value) => value.trim())
	.filter(Boolean);

function run(command, options = {}) {
	execSync(command, {
		stdio: "inherit",
		...options,
	});
}

function ensureCommandAvailable(command) {
	try {
		execSync(`command -v ${command}`, { stdio: "ignore" });
	} catch {
		throw new Error(`Missing required build tool: ${command}`);
	}
}

function downloadFile(url, destinationPath) {
	return new Promise((resolve, reject) => {
		const request = get(url, (response) => {
			if (
				response.statusCode &&
				response.statusCode >= 300 &&
				response.statusCode < 400 &&
				typeof response.headers.location === "string"
			) {
				response.resume();
				void downloadFile(response.headers.location, destinationPath).then(resolve).catch(reject);
				return;
			}

			if (response.statusCode !== 200) {
				reject(new Error(`Failed to download ${url}: status ${response.statusCode}`));
				return;
			}

			const fileStream = createWriteStream(destinationPath);
			response.pipe(fileStream);
			fileStream.on("finish", () => {
				fileStream.close();
				resolve();
			});
			fileStream.on("error", reject);
		});

		request.on("error", reject);
	});
}

function resolveVersionFilePath(arch) {
	return join(runtimeCoreLinuxSandboxDir, arch, "VERSION.txt");
}

function readExistingVersion(arch) {
	const versionFile = resolveVersionFilePath(arch);
	if (!existsSync(versionFile)) return undefined;
	return readFileSync(versionFile, "utf8").trim();
}

async function moveFileAcrossFilesystems(sourcePath, destinationPath) {
	try {
		await rename(sourcePath, destinationPath);
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "EXDEV") {
			throw error;
		}

		await copyFile(sourcePath, destinationPath);
		await rm(sourcePath, { force: true });
	}
}

async function buildForCurrentArch(arch) {
	if (!supportedArchs.has(arch)) {
		throw new Error(`Unsupported Linux bubblewrap target arch: ${arch}`);
	}
	if (arch !== process.arch) {
		throw new Error(
			`Cross-compiling bubblewrap is not supported by this script. Requested ${arch}, current host is ${process.arch}.`,
		);
	}

	const existingVersion = readExistingVersion(arch);
	const outputDir = join(runtimeCoreLinuxSandboxDir, arch);
	const outputPath = join(outputDir, "bwrap");
	if (existingVersion === bubblewrapVersion && existsSync(outputPath) && statSync(outputPath).size > 0) {
		console.log(`[prepare-bwrap] ${arch} already built at version ${bubblewrapVersion}, skipping`);
		return;
	}

	const workDir = join(tmpdir(), `vetta-bwrap-${bubblewrapVersion}-${arch}`);
	const archivePath = join(workDir, `bubblewrap-${bubblewrapVersion}.tar.xz`);
	const sourceDir = join(workDir, `bubblewrap-${bubblewrapVersion}`);
	const buildDir = join(sourceDir, "_builddir");
	const archiveUrl = `https://github.com/containers/bubblewrap/releases/download/v${bubblewrapVersion}/bubblewrap-${bubblewrapVersion}.tar.xz`;

	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(workDir, { recursive: true });

	console.log(`[prepare-bwrap] downloading ${archiveUrl}`);
	await downloadFile(archiveUrl, archivePath);

	console.log(`[prepare-bwrap] extracting ${archivePath}`);
	run(`tar -xJf "${archivePath}" -C "${workDir}"`);

	console.log(`[prepare-bwrap] configuring bubblewrap ${bubblewrapVersion} for ${arch}`);
	run(`meson setup "${buildDir}" "${sourceDir}" -Dtests=false`, { cwd: workDir });

	console.log(`[prepare-bwrap] compiling bubblewrap ${bubblewrapVersion} for ${arch}`);
	run(`meson compile -C "${buildDir}"`, { cwd: workDir });

	mkdirSync(outputDir, { recursive: true });
	const builtBinaryPath = join(buildDir, "bwrap");
	const tempOutputPath = `${outputPath}.tmp`;
	await moveFileAcrossFilesystems(builtBinaryPath, tempOutputPath);
	await chmod(tempOutputPath, 0o755);
	rmSync(outputPath, { force: true });
	await moveFileAcrossFilesystems(tempOutputPath, outputPath);
	writeFileSync(resolveVersionFilePath(arch), `${bubblewrapVersion}\n`, "utf8");
	console.log(`[prepare-bwrap] wrote ${outputPath}`);
}

async function main() {
	if (process.env.VETTA_SKIP_BWRAP_BUILD === "true") {
		console.log("[prepare-bwrap] skipped via VETTA_SKIP_BWRAP_BUILD=true");
		return;
	}

	if (process.platform !== "linux") {
		console.log(`[prepare-bwrap] skipped on non-Linux host: ${process.platform}`);
		return;
	}

	for (const command of ["meson", "tar", "cc", "pkg-config"]) {
		ensureCommandAvailable(command);
	}

	for (const arch of targetArchs) {
		await buildForCurrentArch(arch);
	}
}

void main().catch((error) => {
	console.error("[prepare-bwrap] failed", error);
	process.exitCode = 1;
});
