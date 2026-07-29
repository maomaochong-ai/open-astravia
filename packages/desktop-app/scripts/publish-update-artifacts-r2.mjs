import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const projectRoot = join(import.meta.dirname, "..");
const releaseDir = join(projectRoot, "release");
const metadataPattern = /^latest(?:-(?:mac|linux))?\.ya?ml$/i;
const artifactPattern = /\.(?:appimage|blockmap|dmg|exe|zip)$/i;

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

async function collectArtifacts() {
	const entries = await readdir(releaseDir, { withFileTypes: true });
	const files = entries
		.filter((entry) => entry.isFile() && (metadataPattern.test(entry.name) || artifactPattern.test(entry.name)))
		.map((entry) => entry.name);

	if (!files.some((fileName) => metadataPattern.test(fileName))) {
		throw new Error(`[publish-updates-r2] no electron-updater metadata found in ${releaseDir}`);
	}

	// 更新清单最后上传，确保客户端看见新版本时，其引用的安装包和 blockmap 已经存在。
	return files.sort((left, right) => Number(metadataPattern.test(left)) - Number(metadataPattern.test(right)));
}

async function main() {
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

	for (const fileName of await collectArtifacts()) {
		const filePath = join(releaseDir, fileName);
		const fileStat = await stat(filePath);
		const isMetadata = metadataPattern.test(fileName);
		const key = prefix ? posix.join(prefix, basename(fileName)) : basename(fileName);
		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: createReadStream(filePath),
				ContentLength: fileStat.size,
				ContentType: contentTypeFor(fileName),
				CacheControl: isMetadata
					? "public, max-age=60, s-maxage=60, must-revalidate"
					: "public, max-age=31536000, immutable",
			}),
		);
		console.log(`[publish-updates-r2] uploaded ${key}`);
	}
}

await main();
