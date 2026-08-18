import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { inflateRawSync } from "node:zlib";
import { parse } from "yaml";

const defaultReleaseDir = resolve(import.meta.dirname, "../release");
const metadataPattern = /^latest-linux(?:-[a-z0-9_-]+)?\.ya?ml$/i;

function getArtifactFileName(value) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("[verify-linux-update] update metadata contains an invalid artifact URL");
	}
	let pathname = value;
	try {
		pathname = new URL(value, "https://updates.invalid/").pathname;
	} catch {
		// electron-builder normally writes a relative artifact name.
	}
	const fileName = basename(decodeURIComponent(pathname));
	if (!fileName || fileName === "." || fileName === "..") {
		throw new Error(`[verify-linux-update] cannot resolve artifact file name: ${value}`);
	}
	return fileName;
}

async function sha512Base64(filePath) {
	const hash = createHash("sha512");
	await pipeline(createReadStream(filePath), hash);
	return hash.digest("base64");
}

async function verifyEmbeddedBlockMap(filePath, fileSize, blockMapSize) {
	const handle = await open(filePath, "r");
	try {
		const sizeBuffer = Buffer.allocUnsafe(4);
		const sizeRead = await handle.read(sizeBuffer, 0, sizeBuffer.length, fileSize - sizeBuffer.length);
		if (sizeRead.bytesRead !== sizeBuffer.length) {
			throw new Error(`[verify-linux-update] cannot read embedded block map size for ${basename(filePath)}`);
		}
		if (sizeBuffer.readUInt32BE(0) !== blockMapSize) {
			throw new Error(`[verify-linux-update] embedded block map length mismatch for ${basename(filePath)}`);
		}
		const compressed = Buffer.allocUnsafe(blockMapSize);
		const blockMapRead = await handle.read(
			compressed,
			0,
			compressed.length,
			fileSize - sizeBuffer.length - blockMapSize,
		);
		if (blockMapRead.bytesRead !== compressed.length) {
			throw new Error(`[verify-linux-update] cannot read embedded block map for ${basename(filePath)}`);
		}
		const blockMap = JSON.parse(inflateRawSync(compressed).toString("utf8"));
		if (!blockMap || typeof blockMap !== "object" || !Array.isArray(blockMap.files)) {
			throw new Error(`[verify-linux-update] invalid embedded block map for ${basename(filePath)}`);
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("[verify-linux-update]")) throw error;
		throw new Error(`[verify-linux-update] cannot read embedded block map for ${basename(filePath)}`, {
			cause: error,
		});
	} finally {
		await handle.close();
	}
}

async function verifyArtifact(releaseDir, file) {
	if (!file || typeof file !== "object") {
		throw new Error("[verify-linux-update] update metadata contains an invalid files entry");
	}
	const fileName = getArtifactFileName(file.url);
	const filePath = join(releaseDir, fileName);
	const fileStat = await stat(filePath).catch(() => null);
	if (!fileStat?.isFile()) {
		throw new Error(`[verify-linux-update] referenced artifact does not exist: ${fileName}`);
	}
	if (!Number.isSafeInteger(file.size) || file.size !== fileStat.size) {
		throw new Error(
			`[verify-linux-update] size mismatch for ${fileName}: metadata=${String(file.size)} actual=${fileStat.size}`,
		);
	}
	if (typeof file.sha512 !== "string" || file.sha512.length === 0) {
		throw new Error(`[verify-linux-update] missing SHA-512 for ${fileName}`);
	}
	const actualSha512 = await sha512Base64(filePath);
	if (actualSha512 !== file.sha512) {
		throw new Error(`[verify-linux-update] SHA-512 mismatch for ${fileName}`);
	}
	if (
		fileName.toLowerCase().endsWith(".appimage") &&
		(!Number.isSafeInteger(file.blockMapSize) || file.blockMapSize <= 0 || file.blockMapSize >= fileStat.size)
	) {
		throw new Error(`[verify-linux-update] invalid embedded block map size for ${fileName}`);
	}
	if (fileName.toLowerCase().endsWith(".appimage")) {
		await verifyEmbeddedBlockMap(filePath, fileStat.size, file.blockMapSize);
	}
	return { fileName, sha512: actualSha512 };
}

async function verifyMetadata(releaseDir, metadataFile) {
	const document = parse(await readFile(join(releaseDir, metadataFile), "utf8"));
	if (!document || typeof document !== "object" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
		throw new Error(`[verify-linux-update] ${metadataFile} has an invalid version`);
	}
	if (!Array.isArray(document.files) || document.files.length === 0) {
		throw new Error(`[verify-linux-update] ${metadataFile} does not contain update files`);
	}

	const artifacts = [];
	for (const file of document.files) artifacts.push(await verifyArtifact(releaseDir, file));
	if (!artifacts.some((artifact) => artifact.fileName.toLowerCase().endsWith(".appimage"))) {
		throw new Error(`[verify-linux-update] ${metadataFile} does not reference an AppImage`);
	}
	if (typeof document.path !== "string" || document.path.length === 0) {
		throw new Error(`[verify-linux-update] ${metadataFile} has no primary artifact`);
	}
	const primaryName = getArtifactFileName(document.path);
	const primary = artifacts.find((artifact) => artifact.fileName === primaryName);
	if (!primary || document.sha512 !== primary.sha512) {
		throw new Error(`[verify-linux-update] primary artifact mismatch for ${primaryName}`);
	}
	return document.version;
}

export async function verifyLinuxUpdates({ releaseDir = defaultReleaseDir } = {}) {
	const metadataFiles = (await readdir(releaseDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && metadataPattern.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	if (metadataFiles.length === 0) {
		throw new Error("[verify-linux-update] no Linux update metadata found");
	}
	const versions = new Set();
	for (const metadataFile of metadataFiles) {
		versions.add(await verifyMetadata(releaseDir, metadataFile));
	}
	if (versions.size !== 1) {
		throw new Error("[verify-linux-update] Linux update metadata must contain exactly one version");
	}
	const version = [...versions][0];
	console.info(`[verify-linux-update] Linux update files verified: ${version}`);
	return { version, metadataFiles };
}

export async function main() {
	await verifyLinuxUpdates();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
