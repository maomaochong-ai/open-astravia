import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { parse } from "yaml";

const projectRoot = join(import.meta.dirname, "..");
const releaseDir = join(projectRoot, "release");
const metadataPattern = /^latest(?:-(?:mac|linux)(?:-[a-z0-9_-]+)?)?\.ya?ml$/i;
const artifactPattern = /\.(?:appimage|blockmap|dmg|exe|zip)$/i;
const multipartPartSize = 16 * 1024 * 1024;

function requireEnv(key) {
	const value = process.env[key]?.trim();
	if (!value) throw new Error(`[publish-updates-r2] missing ${key}`);
	return value;
}

function normalizePrefix(rawPrefix) {
	return rawPrefix
		.split("/")
		.map((part) => part.trim())
		.filter(Boolean)
		.join("/");
}

function normalizeUrlPrefix(rawUrl) {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("[publish-updates-r2] VETTA_UPDATE_URL must use http or https");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("[publish-updates-r2] VETTA_UPDATE_URL must not contain credentials, query, or hash");
	}
	return decodeURIComponent(url.pathname)
		.split("/")
		.map((part) => part.trim())
		.filter(Boolean)
		.join("/");
}

export function validatePublishTarget({ prefix, updateUrl, releaseVersion, packageVersion }) {
	const urlPrefix = normalizeUrlPrefix(updateUrl);
	if (urlPrefix !== prefix) {
		throw new Error(
			`[publish-updates-r2] VETTA_UPDATE_URL path "${urlPrefix}" does not match VETTA_R2_PREFIX "${prefix}"`,
		);
	}
	if (prefix.split("/").at(-1) === "stable" && releaseVersion !== packageVersion) {
		throw new Error(
			`[publish-updates-r2] refusing QA version ${releaseVersion} on stable; package version is ${packageVersion}`,
		);
	}
}

function contentTypeFor(fileName) {
	const lower = fileName.toLowerCase();
	if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "application/yaml";
	if (lower.endsWith(".zip")) return "application/zip";
	if (lower.endsWith(".dmg")) return "application/x-apple-diskimage";
	if (lower.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
	return "application/octet-stream";
}

function referencedFileName(reference) {
	if (typeof reference !== "string" || !reference.trim()) return undefined;
	let pathname = reference.trim().split(/[?#]/, 1)[0];
	try {
		pathname = new URL(reference).pathname;
	} catch {
		// electron-builder 的更新清单通常使用相对路径。
	}
	const fileName = posix.basename(decodeURIComponent(pathname.replaceAll("\\", "/")));
	return artifactPattern.test(fileName) ? fileName : undefined;
}

export async function collectArtifacts(directory = releaseDir) {
	const entries = await readdir(directory, { withFileTypes: true });
	const availableFiles = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
	const metadataFiles = [...availableFiles].filter((fileName) => metadataPattern.test(fileName)).sort();

	if (metadataFiles.length === 0) {
		throw new Error(`[publish-updates-r2] no electron-updater metadata found in ${directory}`);
	}

	const artifacts = new Set();
	for (const metadataFile of metadataFiles) {
		const document = parse(await readFile(join(directory, metadataFile), "utf8"));
		const references = [
			document?.path,
			...(Array.isArray(document?.files) ? document.files.map((file) => file?.url) : []),
		];
		for (const reference of references) {
			const fileName = referencedFileName(reference);
			if (!fileName) continue;
			if (!availableFiles.has(fileName)) {
				throw new Error(`[publish-updates-r2] ${metadataFile} references missing artifact ${fileName}`);
			}
			artifacts.add(fileName);
			const blockmap = `${fileName}.blockmap`;
			if (availableFiles.has(blockmap)) artifacts.add(blockmap);
		}
	}

	if (artifacts.size === 0) {
		throw new Error(`[publish-updates-r2] updater metadata does not reference any artifacts in ${directory}`);
	}

	// 更新清单最后上传，确保客户端看见新版本时，其引用的安装包和 blockmap 已经存在。
	return [...artifacts].sort().concat(metadataFiles);
}

export async function readReleaseVersion(directory = releaseDir) {
	const metadataFiles = (await readdir(directory, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && metadataPattern.test(entry.name))
		.map((entry) => entry.name);
	const versions = new Set();
	for (const metadataFile of metadataFiles) {
		const document = parse(await readFile(join(directory, metadataFile), "utf8"));
		if (typeof document?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
			throw new Error(`[publish-updates-r2] ${metadataFile} has an invalid version`);
		}
		versions.add(document.version);
	}
	if (versions.size !== 1) {
		throw new Error(`[publish-updates-r2] updater metadata must contain exactly one version`);
	}
	return [...versions][0];
}

async function hashFile(filePath) {
	const hash = createHash("sha512");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest("hex");
}

async function inspectVersionedObject(client, bucket, key, filePath, contentLength) {
	const sha512 = await hashFile(filePath);
	try {
		const existing = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		if (existing.ContentLength === contentLength && existing.Metadata?.sha512 === sha512) {
			return { sha512, shouldUpload: false };
		}
		throw new Error(
			`[publish-updates-r2] refusing to overwrite existing versioned object ${key}; content differs or lacks sha512 metadata`,
		);
	} catch (error) {
		if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
			return { sha512, shouldUpload: true };
		}
		throw error;
	}
}

async function uploadFile({ client, bucket, prefix, fileName, isMetadata }) {
	const filePath = join(releaseDir, fileName);
	const fileStat = await stat(filePath);
	const key = prefix ? posix.join(prefix, fileName) : fileName;
	let sha512;
	if (!isMetadata) {
		const inspection = await inspectVersionedObject(client, bucket, key, filePath, fileStat.size);
		sha512 = inspection.sha512;
		if (!inspection.shouldUpload) {
			console.log(`[publish-updates-r2] verified existing ${key}`);
			return;
		}
	}
	const upload = new Upload({
		client,
		queueSize: 4,
		partSize: multipartPartSize,
		leavePartsOnError: false,
		params: {
			Bucket: bucket,
			Key: key,
			Body: createReadStream(filePath),
			ContentLength: fileStat.size,
			ContentType: contentTypeFor(fileName),
			CacheControl: isMetadata
				? "public, max-age=60, s-maxage=60, must-revalidate"
				: "public, max-age=31536000, immutable",
			...(sha512 ? { Metadata: { sha512 } } : {}),
		},
	});
	await upload.done();
	console.log(`[publish-updates-r2] uploaded ${key}`);
}

async function verifyPublicFiles(baseUrl, fileNames) {
	const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, "")}/`;
	for (const fileName of fileNames) {
		const url = new URL(fileName.split("/").map(encodeURIComponent).join("/"), normalizedBaseUrl);
		url.searchParams.set("publish-check", Date.now().toString());
		let lastError;
		for (let attempt = 1; attempt <= 4; attempt += 1) {
			try {
				const response = await fetch(url, { method: "HEAD", cache: "no-store" });
				if (response.ok) {
					lastError = undefined;
					break;
				}
				lastError = new Error(`HTTP ${response.status}`);
			} catch (error) {
				lastError = error;
			}
			if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
		}
		if (lastError) {
			throw new Error(`[publish-updates-r2] public verification failed for ${url}`, { cause: lastError });
		}
	}
}

export async function main() {
	const accountId = requireEnv("VETTA_R2_ACCOUNT_ID");
	const accessKeyId = requireEnv("VETTA_R2_ACCESS_KEY_ID");
	const secretAccessKey = requireEnv("VETTA_R2_SECRET_ACCESS_KEY");
	const bucket = requireEnv("VETTA_R2_BUCKET");
	const prefix = normalizePrefix(process.env.VETTA_R2_PREFIX ?? "desktop/stable");
	const updateUrl = requireEnv("VETTA_UPDATE_URL");
	const releaseVersion = await readReleaseVersion();
	const packageVersion = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")).version;
	validatePublishTarget({ prefix, updateUrl, releaseVersion, packageVersion });
	const client = new S3Client({
		region: "auto",
		endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
		credentials: { accessKeyId, secretAccessKey },
	});

	const files = await collectArtifacts();
	const artifactFiles = files.filter((fileName) => !metadataPattern.test(fileName));
	const metadataFiles = files.filter((fileName) => metadataPattern.test(fileName));
	for (const fileName of artifactFiles) {
		await uploadFile({ client, bucket, prefix, fileName, isMetadata: false });
	}
	await verifyPublicFiles(updateUrl, artifactFiles);
	for (const fileName of metadataFiles) {
		await uploadFile({ client, bucket, prefix, fileName, isMetadata: true });
	}
	await verifyPublicFiles(updateUrl, metadataFiles);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
