import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);
const packageDir = resolve(import.meta.dirname, "..");
const defaultReleaseDir = join(packageDir, "release");
const expectedBundleIdentifier = "com.vetta.desktop";

function getArtifactFileName(value) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("[verify-mac-update] update metadata contains an invalid artifact URL");
	}
	let pathname = value;
	try {
		pathname = new URL(value, "https://updates.invalid/").pathname;
	} catch {
		// A plain file name is valid metadata and is handled below.
	}
	const fileName = basename(decodeURIComponent(pathname));
	if (!fileName || fileName === "." || fileName === "..") {
		throw new Error(`[verify-mac-update] cannot resolve artifact file name: ${value}`);
	}
	return fileName;
}

async function sha512Base64(filePath) {
	const hash = createHash("sha512");
	await pipeline(createReadStream(filePath), hash);
	return hash.digest("base64");
}

async function verifyArtifact(releaseDir, file) {
	if (!file || typeof file !== "object") {
		throw new Error("[verify-mac-update] latest-mac.yml contains an invalid files entry");
	}
	const fileName = getArtifactFileName(file.url);
	const filePath = join(releaseDir, fileName);
	const fileStat = await stat(filePath).catch(() => null);
	if (!fileStat?.isFile()) {
		throw new Error(`[verify-mac-update] referenced artifact does not exist: ${fileName}`);
	}
	if (!Number.isSafeInteger(file.size) || file.size !== fileStat.size) {
		throw new Error(
			`[verify-mac-update] size mismatch for ${fileName}: metadata=${String(file.size)} actual=${fileStat.size}`,
		);
	}
	if (typeof file.sha512 !== "string" || file.sha512.length === 0) {
		throw new Error(`[verify-mac-update] missing SHA-512 for ${fileName}`);
	}
	const actualSha512 = await sha512Base64(filePath);
	if (actualSha512 !== file.sha512) {
		throw new Error(`[verify-mac-update] SHA-512 mismatch for ${fileName}`);
	}
	return { fileName, filePath, sha512: actualSha512 };
}

async function verifyPrimaryArtifact(document, artifacts) {
	if (typeof document.path !== "string" || document.path.length === 0) return;
	const primaryName = getArtifactFileName(document.path);
	const primary = artifacts.find((artifact) => artifact.fileName === primaryName);
	if (!primary) {
		throw new Error(`[verify-mac-update] primary artifact is missing from files: ${primaryName}`);
	}
	if (typeof document.sha512 !== "string" || document.sha512 !== primary.sha512) {
		throw new Error(`[verify-mac-update] primary SHA-512 mismatch for ${primaryName}`);
	}
}

async function verifyBlockmaps(artifacts) {
	const zipArtifacts = artifacts.filter((artifact) => artifact.fileName.toLowerCase().endsWith(".zip"));
	if (zipArtifacts.length === 0) {
		throw new Error("[verify-mac-update] latest-mac.yml does not reference a ZIP update artifact");
	}
	for (const artifact of zipArtifacts) {
		const blockmapPath = `${artifact.filePath}.blockmap`;
		const blockmapStat = await stat(blockmapPath).catch(() => null);
		if (!blockmapStat?.isFile() || blockmapStat.size === 0) {
			throw new Error(`[verify-mac-update] missing ZIP blockmap: ${basename(blockmapPath)}`);
		}
	}
	return zipArtifacts;
}

async function findTopLevelApp(extractDir) {
	const entries = await readdir(extractDir, { withFileTypes: true });
	const appEntries = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
	if (appEntries.length !== 1) {
		throw new Error(
			`[verify-mac-update] expected one top-level .app in update ZIP, found ${appEntries.length}`,
		);
	}
	return join(extractDir, appEntries[0].name);
}

async function readPlistValue(infoPlistPath, key) {
	const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
		"-c",
		`Print :${key}`,
		infoPlistPath,
	]);
	return stdout.trim();
}

async function verifySignedZip(zipPath, expectedVersion) {
	if (process.platform !== "darwin") {
		throw new Error("[verify-mac-update] signed Mac verification must run on macOS");
	}
	const extractDir = await mkdtemp(join(tmpdir(), "vetta-mac-update-"));
	try {
		await execFileAsync("ditto", ["-x", "-k", zipPath, extractDir]);
		const appPath = await findTopLevelApp(extractDir);
		const infoPlistPath = join(appPath, "Contents", "Info.plist");
		const [bundleVersion, bundleIdentifier] = await Promise.all([
			readPlistValue(infoPlistPath, "CFBundleShortVersionString"),
			readPlistValue(infoPlistPath, "CFBundleIdentifier"),
		]);
		if (bundleVersion !== expectedVersion) {
			throw new Error(
				`[verify-mac-update] app version ${bundleVersion} does not match metadata ${expectedVersion}`,
			);
		}
		if (bundleIdentifier !== expectedBundleIdentifier) {
			throw new Error(
				`[verify-mac-update] app identifier ${bundleIdentifier} does not match ${expectedBundleIdentifier}`,
			);
		}
		await execFileAsync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
		await execFileAsync("spctl", ["-a", "-vvv", "-t", "exec", appPath]);
		await execFileAsync("xcrun", ["stapler", "validate", appPath]);
	} finally {
		await rm(extractDir, { recursive: true, force: true });
	}
}

export async function verifyMacUpdate({ releaseDir = defaultReleaseDir, requireSignature } = {}) {
	const metadataPath = join(releaseDir, "latest-mac.yml");
	const document = parse(await readFile(metadataPath, "utf8"));
	if (!document || typeof document !== "object" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
		throw new Error("[verify-mac-update] latest-mac.yml has an invalid version");
	}
	if (!Array.isArray(document.files) || document.files.length === 0) {
		throw new Error("[verify-mac-update] latest-mac.yml does not contain update files");
	}

	const artifacts = [];
	for (const file of document.files) artifacts.push(await verifyArtifact(releaseDir, file));
	await verifyPrimaryArtifact(document, artifacts);
	const zipArtifacts = await verifyBlockmaps(artifacts);

	const shouldVerifySignature =
		requireSignature ?? process.env.VETTA_REQUIRE_MAC_SIGNATURE === "1";
	if (shouldVerifySignature) {
		for (const artifact of zipArtifacts) await verifySignedZip(artifact.filePath, document.version);
		console.info(`[verify-mac-update] signed and notarized Mac update verified: ${document.version}`);
	} else {
		console.info(
			`[verify-mac-update] Mac update files verified: ${document.version} (signature check skipped)`,
		);
	}
	return { version: document.version, artifacts };
}

export async function main() {
	await verifyMacUpdate();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
