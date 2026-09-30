// 把发版流水线暂存在 <prefix>/pending/<版本>/ 的更新清单上线到 <prefix>/：
// 合并 macOS 两个架构的清单，确认清单引用的安装包已在 R2 且哈希、大小一致，
// 拒绝降级，最后上传清单并通过公网地址复核。用户从这一刻起收到新版本。
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { parse } from "yaml";
import { mergeMacUpdateMetadata } from "./merge-mac-update-metadata.mjs";
import {
	contentTypeFor,
	METADATA_CACHE_CONTROL,
	normalizePrefix,
	requireEnv,
	stagedMetadataPrefix,
	validatePublishTarget,
	verifyRemoteMetadataVersions,
} from "./publish-update-artifacts-r2.mjs";
import { referencedFileName } from "./updater-metadata.mjs";
import { verifyUpdateFeed } from "./verify-update-feed.mjs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export const PLATFORM_METADATA = Object.freeze({
	windows: { published: "latest.yml", staged: ["latest.yml"] },
	mac: { published: "latest-mac.yml", staged: ["latest-mac-arm64.yml", "latest-mac-x64.yml"] },
	linux: { published: "latest-linux.yml", staged: ["latest-linux.yml"] },
});

export function parsePlatforms(value) {
	const platforms = [
		...new Set(
			String(value ?? "")
				.split(",")
				.map((platform) => platform.trim().toLowerCase())
				.filter(Boolean),
		),
	];
	if (platforms.length === 0) throw new Error("[promote-updates] no platform selected");
	const unknown = platforms.filter((platform) => !Object.hasOwn(PLATFORM_METADATA, platform));
	if (unknown.length > 0) {
		throw new Error(
			`[promote-updates] unknown platform(s): ${unknown.join(", ")}; use ${Object.keys(PLATFORM_METADATA).join(", ")}`,
		);
	}
	return platforms;
}

function sha512Hex(base64) {
	return Buffer.from(base64, "base64").toString("hex");
}

/**
 * 在只含待上线清单的目录里合并 macOS 清单，并列出每份清单要求 R2 上已存在的安装包。
 */
export async function preparePromotion({ directory, version, platforms }) {
	const available = new Set(await readdir(directory));
	const missing = platforms.flatMap((platform) =>
		PLATFORM_METADATA[platform].staged.filter((fileName) => !available.has(fileName)),
	);
	if (missing.length > 0) {
		throw new Error(
			`[promote-updates] staged metadata for ${version} is missing ${missing.join(", ")}; wait for those platform builds or deselect the platform`,
		);
	}
	if (platforms.includes("mac")) await mergeMacUpdateMetadata({ releaseDir: directory });

	const plan = [];
	for (const platform of platforms) {
		const fileName = PLATFORM_METADATA[platform].published;
		const document = parse(await readFile(join(directory, fileName), "utf8"));
		if (document?.version !== version) {
			throw new Error(`[promote-updates] ${fileName} has version ${String(document?.version)}, expected ${version}`);
		}
		const files = Array.isArray(document.files) ? document.files : [];
		if (files.length === 0) throw new Error(`[promote-updates] ${fileName} does not list any installer`);
		const artifacts = files.map((file) => {
			const name = referencedFileName(file?.url);
			if (!name || typeof file.sha512 !== "string" || !file.sha512) {
				throw new Error(`[promote-updates] ${fileName} has an invalid file entry: ${JSON.stringify(file)}`);
			}
			return { name, sha512: sha512Hex(file.sha512), size: file.size };
		});
		plan.push({ platform, fileName, artifacts });
	}
	return plan;
}

/**
 * 清单里的 sha512 与安装包上传时记在对象元数据里的 sha512 必须一致，否则客户端下载后校验失败。
 */
export async function verifyStoredArtifacts(plan, headArtifact) {
	for (const { fileName, artifacts } of plan) {
		for (const artifact of artifacts) {
			const head = await headArtifact(artifact.name);
			if (!head) {
				throw new Error(`[promote-updates] ${fileName} references ${artifact.name}, which is not on R2`);
			}
			if (head.Metadata?.sha512 !== artifact.sha512) {
				throw new Error(`[promote-updates] ${artifact.name} on R2 does not match the sha512 in ${fileName}`);
			}
			if (typeof artifact.size === "number" && head.ContentLength !== artifact.size) {
				throw new Error(
					`[promote-updates] ${artifact.name} on R2 is ${head.ContentLength} bytes, ${fileName} expects ${artifact.size}`,
				);
			}
		}
	}
}

// 只取所选平台的清单：输出目录里留下的就是要上线的文件，未选平台不会被带出去。
async function downloadStagedMetadata({ client, bucket, stagedPrefix, directory, platforms }) {
	const wanted = new Set(platforms.flatMap((platform) => PLATFORM_METADATA[platform].staged));
	const listing = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${stagedPrefix}/` }));
	const keys = (listing.Contents ?? []).map((object) => object.Key).filter(Boolean);
	for (const key of keys) {
		const fileName = posix.basename(key);
		if (!wanted.has(fileName)) continue;
		const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
		await writeFile(join(directory, fileName), await object.Body.transformToString());
	}
}

export async function main(argv = process.argv.slice(2)) {
	const { values } = parseArgs({
		args: argv,
		options: {
			version: { type: "string" },
			platforms: { type: "string", default: Object.keys(PLATFORM_METADATA).join(",") },
			"dry-run": { type: "boolean", default: false },
			"output-dir": { type: "string" },
		},
	});
	const version = values.version?.trim().replace(/^v/, "");
	if (!version || !VERSION_PATTERN.test(version)) {
		throw new Error("[promote-updates] --version must be a semantic version such as 0.5.60");
	}
	const platforms = parsePlatforms(values.platforms);
	const bucket = requireEnv("VETTA_R2_BUCKET");
	const prefix = normalizePrefix(process.env.VETTA_R2_PREFIX ?? "desktop/stable");
	const updateUrl = requireEnv("VETTA_UPDATE_URL");
	validatePublishTarget({ prefix, updateUrl, releaseVersion: version, packageVersion: version });
	const client = new S3Client({
		region: "auto",
		endpoint: `https://${requireEnv("VETTA_R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: requireEnv("VETTA_R2_ACCESS_KEY_ID"),
			secretAccessKey: requireEnv("VETTA_R2_SECRET_ACCESS_KEY"),
		},
	});

	const directory = values["output-dir"] ?? (await mkdtemp(join(tmpdir(), "vetta-promote-")));
	await mkdir(directory, { recursive: true });
	const stagedPrefix = stagedMetadataPrefix(prefix, version);
	await downloadStagedMetadata({ client, bucket, stagedPrefix, directory, platforms });
	const plan = await preparePromotion({ directory, version, platforms });

	await verifyStoredArtifacts(plan, async (name) => {
		try {
			return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: posix.join(prefix, name) }));
		} catch (error) {
			if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return undefined;
			throw error;
		}
	});
	const metadataFiles = plan.map(({ fileName }) => fileName);
	await verifyRemoteMetadataVersions({ updateUrl, metadataFiles, releaseVersion: version });

	for (const { fileName, artifacts } of plan) {
		console.log(`[promote-updates] ${fileName}: ${artifacts.map(({ name }) => name).join(", ")}`);
	}
	if (values["dry-run"]) {
		console.log(`[promote-updates] dry run: ${metadataFiles.join(", ")} verified in ${directory}, nothing published`);
		return;
	}

	for (const fileName of metadataFiles) {
		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: posix.join(prefix, fileName),
				Body: await readFile(join(directory, fileName)),
				ContentType: contentTypeFor(fileName),
				CacheControl: METADATA_CACHE_CONTROL,
			}),
		);
		console.log(`[promote-updates] published ${posix.join(prefix, fileName)}`);
	}
	await verifyLiveFeed({ updateUrl, version, metadataFiles });
	console.log(`[promote-updates] ${version} is live for ${platforms.join(", ")}`);
}

// CDN 对旧清单最多缓存 60 秒（METADATA_CACHE_CONTROL），刚上传时公网可能仍返回旧版本。
export async function verifyLiveFeed({
	updateUrl,
	version,
	metadataFiles,
	verify = verifyUpdateFeed,
	attempts = 6,
	delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await verify({
				env: { ...process.env, VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: updateUrl },
				version,
				metadataFiles,
			});
		} catch (error) {
			if (attempt >= attempts) throw error;
			console.log(`[promote-updates] public feed not updated yet (${error.message}); retrying in 20s`);
			await delay(20_000);
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
