import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
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

async function verifyPublicFiles(baseUrl, fileNames) {
	if (!baseUrl) return;
	const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, "")}/`;
	for (const fileName of fileNames) {
		const url = new URL(fileName.split("/").map(encodeURIComponent).join("/"), normalizedBaseUrl);
		url.searchParams.set("publish-check", Date.now().toString());
		const response = await fetch(url, { method: "HEAD", cache: "no-store" });
		if (!response.ok) {
			throw new Error(`[publish-updates-r2] public verification failed for ${url}: HTTP ${response.status}`);
		}
	}
}

export async function main() {
	const accountId = requireEnv("VETTA_R2_ACCOUNT_ID");
	const accessKeyId = requireEnv("VETTA_R2_ACCESS_KEY_ID");
	const secretAccessKey = requireEnv("VETTA_R2_SECRET_ACCESS_KEY");
	const bucket = requireEnv("VETTA_R2_BUCKET");
	const prefix = normalizePrefix(process.env.VETTA_R2_PREFIX ?? "desktop/stable");
	const client = new S3Client({
		region: "auto",
		endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
		credentials: { accessKeyId, secretAccessKey },
	});

	const files = await collectArtifacts();
	const artifactFiles = files.filter((fileName) => !metadataPattern.test(fileName));
	const metadataFiles = files.filter((fileName) => metadataPattern.test(fileName));
	for (const fileName of files) {
		const filePath = join(releaseDir, fileName);
		const fileStat = await stat(filePath);
		const isMetadata = metadataPattern.test(fileName);
		const key = prefix ? posix.join(prefix, fileName) : fileName;
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
			},
		});
		await upload.done();
		console.log(`[publish-updates-r2] uploaded ${key}`);
		if (fileName === artifactFiles.at(-1)) {
			await verifyPublicFiles(process.env.VETTA_UPDATE_URL?.trim(), artifactFiles);
		}
	}
	await verifyPublicFiles(process.env.VETTA_UPDATE_URL?.trim(), metadataFiles);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
