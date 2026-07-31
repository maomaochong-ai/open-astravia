import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

// arm64 与 x64 必须分两次构建（内置的 node/python 运行时按 VETTA_VENDOR_PLATFORM
// 单架构落盘），而 electron-builder 两次都写同一个 latest-mac.yml，后一次会覆盖前
// 一次。构建产物因此按 latest-mac-<arch>.yml 上传，发布前在这里合并回单一元数据，
// 否则 electron-updater 的 MacUpdater.filterFilesForArch 会在其中一种架构上找不到
// ZIP 并抛 ERR_UPDATER_ZIP_FILE_NOT_FOUND。
const perArchMetadataPattern = /^latest-mac-([a-z0-9_]+)\.ya?ml$/i;
const defaultReleaseDir = resolve(import.meta.dirname, "..", "release");

function isZip(file) {
	return typeof file?.url === "string" && file.url.toLowerCase().endsWith(".zip");
}

function isArm64(file) {
	return typeof file?.url === "string" && file.url.includes("arm64");
}

// 与 electron-builder 单次多架构构建的产物顺序保持一致：ZIP 在前（旧版
// electron-updater 依赖顶层 path/sha512 指向 ZIP），x64 在 arm64 之前。
function compareFiles(a, b) {
	const zipDiff = (isZip(a) ? 0 : 1) - (isZip(b) ? 0 : 1);
	if (zipDiff !== 0) return zipDiff;
	return (isArm64(a) ? 1 : 0) - (isArm64(b) ? 1 : 0);
}

export async function mergeMacUpdateMetadata({ releaseDir = defaultReleaseDir } = {}) {
	const entries = await readdir(releaseDir).catch(() => []);
	const perArchFiles = entries.filter((entry) => perArchMetadataPattern.test(entry)).sort();
	if (perArchFiles.length === 0) return null;

	const documents = [];
	for (const fileName of perArchFiles) {
		const document = parse(await readFile(join(releaseDir, fileName), "utf8"));
		if (!document || typeof document !== "object" || !Array.isArray(document.files) || document.files.length === 0) {
			throw new Error(`[merge-mac-update] ${fileName} does not contain update files`);
		}
		documents.push({ fileName, document });
	}

	const version = documents[0].document.version;
	for (const { fileName, document } of documents) {
		if (document.version !== version) {
			throw new Error(
				`[merge-mac-update] version mismatch: ${fileName} is ${String(document.version)}, expected ${String(version)}`,
			);
		}
	}

	const filesByUrl = new Map();
	for (const { document } of documents) {
		for (const file of document.files) {
			if (!filesByUrl.has(file.url)) filesByUrl.set(file.url, file);
		}
	}
	const files = [...filesByUrl.values()].sort(compareFiles);
	const primary = files[0];
	const merged = {
		...documents[0].document,
		files,
		path: primary.url,
		sha512: primary.sha512,
	};

	const mergedPath = join(releaseDir, "latest-mac.yml");
	await writeFile(mergedPath, stringify(merged));
	await Promise.all(perArchFiles.map((fileName) => rm(join(releaseDir, fileName), { force: true })));
	console.info(
		`[merge-mac-update] merged ${perArchFiles.join(", ")} -> latest-mac.yml (${files.length} files, ${version})`,
	);
	return merged;
}

export async function main() {
	const merged = await mergeMacUpdateMetadata();
	if (!merged) console.info("[merge-mac-update] no per-architecture Mac metadata found; nothing to merge");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
