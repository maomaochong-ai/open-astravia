import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import { windowsSupplementalArtifactNames } from "./windows-packaging-contract.mjs";

const execFileAsync = promisify(execFile);
const packageDir = resolve(import.meta.dirname, "..");
const defaultReleaseDir = join(packageDir, "release");

async function assertNonEmptyFile(filePath) {
	const info = await stat(filePath);
	if (!info.isFile() || info.size === 0) {
		throw new Error(`[verify-windows-packages] expected a non-empty file: ${filePath}`);
	}
}

async function findFiles(root, fileName, relativeRoot = "") {
	const matches = [];
	for (const entry of await readdir(join(root, relativeRoot), { withFileTypes: true })) {
		const relativePath = join(relativeRoot, entry.name);
		if (entry.isDirectory()) {
			matches.push(...(await findFiles(root, fileName, relativePath)));
		} else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
			matches.push(join(root, relativePath));
		}
	}
	return matches;
}

async function isValidLayoutRoot(root, expectedVersion) {
	try {
		const manifest = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
		if (manifest?.version !== expectedVersion) return false;
		await Promise.all([
			assertNonEmptyFile(join(root, "Vetta.exe")),
			assertNonEmptyFile(join(root, "versions", expectedVersion, "Vetta.exe")),
			assertNonEmptyFile(join(root, "versions", expectedVersion, "resources", "app.asar")),
		]);
		return true;
	} catch {
		return false;
	}
}

export async function verifyExtractedWindowsLayout(root, expectedVersion) {
	const manifests = await findFiles(root, "current.json");
	const validRoots = [];
	for (const manifestPath of manifests) {
		const candidateRoot = dirname(manifestPath);
		if (await isValidLayoutRoot(candidateRoot, expectedVersion)) validRoots.push(candidateRoot);
	}
	if (validRoots.length !== 1) {
		throw new Error(
			`[verify-windows-packages] expected one complete ${expectedVersion} layout in ${root}, found ${validRoots.length}`,
		);
	}
	return validRoots[0];
}

export async function readExpectedWindowsVersion(releaseDir) {
	const document = parse(await readFile(join(releaseDir, "latest.yml"), "utf8"));
	if (typeof document?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
		throw new Error("[verify-windows-packages] latest.yml has an invalid version");
	}
	return document.version;
}

async function extractZip(packagePath, destination) {
	await execFileAsync("tar.exe", ["-xf", packagePath, "-C", destination]);
}

async function extractMsi(packagePath, destination) {
	const logPath = join(destination, "msiexec.log");
	await execFileAsync("msiexec.exe", [
		"/a",
		packagePath,
		"/qn",
		`TARGETDIR=${destination}`,
		"/L*V",
		logPath,
	]);
}

export async function verifyWindowsPackages({ releaseDir = defaultReleaseDir } = {}) {
	if (process.platform !== "win32") {
		throw new Error("[verify-windows-packages] native Windows package verification must run on Windows");
	}
	const expectedVersion = await readExpectedWindowsVersion(releaseDir);
	const [msiFileName, zipFileName] = windowsSupplementalArtifactNames(expectedVersion);
	const msiPath = join(releaseDir, msiFileName);
	const zipPath = join(releaseDir, zipFileName);
	await Promise.all([assertNonEmptyFile(msiPath), assertNonEmptyFile(zipPath)]);

	const extractionRoot = await mkdtemp(join(tmpdir(), "vetta-windows-packages-"));
	const msiRoot = join(extractionRoot, "msi");
	const zipRoot = join(extractionRoot, "zip");
	await Promise.all([mkdir(msiRoot, { recursive: true }), mkdir(zipRoot, { recursive: true })]);
	try {
		await extractMsi(msiPath, msiRoot);
		await extractZip(zipPath, zipRoot);
		await Promise.all([
			verifyExtractedWindowsLayout(msiRoot, expectedVersion),
			verifyExtractedWindowsLayout(zipRoot, expectedVersion),
		]);
		console.info(`[verify-windows-packages] MSI and ZIP packages verified: ${expectedVersion}`);
		return { version: expectedVersion, msiPath, zipPath };
	} finally {
		await rm(extractionRoot, { recursive: true, force: true });
	}
}

export async function main() {
	await verifyWindowsPackages();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
