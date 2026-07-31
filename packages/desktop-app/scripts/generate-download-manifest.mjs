import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

export const updaterMetadataPattern = /^latest(?:-(?:mac|linux)(?:-[a-z0-9_-]+)?)?\.ya?ml$/i;
const artifactPattern = /\.(?:appimage|blockmap|dmg|exe|zip)$/i;
const defaultReleaseDir = resolve(import.meta.dirname, "..", "release");

export function referencedFileName(reference) {
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

function downloadPlatformFor(metadataFile) {
	if (/^latest-mac(?:-|\.)/i.test(metadataFile)) return "mac";
	if (/^latest-linux(?:-|\.)/i.test(metadataFile)) return "linux";
	return "windows";
}

function downloadFormatFor(platform, fileName) {
	const lower = fileName.toLowerCase();
	if (platform === "windows" && lower.endsWith(".exe")) return "exe";
	if (platform === "mac" && lower.endsWith(".dmg")) return "dmg";
	if (platform === "mac" && lower.endsWith(".zip")) return "zip";
	if (platform === "linux" && lower.endsWith(".appimage")) return "appimage";
	return undefined;
}

function downloadArchFor(metadataFile, fileName) {
	return /(?:arm64|aarch64)/i.test(`${metadataFile} ${fileName}`) ? "arm64" : "x64";
}

function downloadPriority(format) {
	// macOS 首次安装优先 DMG；仅有 ZIP 时仍保留可下载入口。
	return format === "dmg" ? 2 : 1;
}

export async function generateDownloadManifest(directory = defaultReleaseDir) {
	const entries = await readdir(directory, { withFileTypes: true });
	const metadataFiles = entries
		.filter((entry) => entry.isFile() && updaterMetadataPattern.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	if (metadataFiles.length === 0) {
		throw new Error(`[generate-download-manifest] no electron-updater metadata found in ${directory}`);
	}

	const versions = new Set();
	const releaseDates = [];
	const downloadsByTarget = new Map();
	for (const metadataFile of metadataFiles) {
		const document = parse(await readFile(join(directory, metadataFile), "utf8"));
		if (typeof document?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
			throw new Error(`[generate-download-manifest] ${metadataFile} has an invalid version`);
		}
		versions.add(document.version);
		if (typeof document.releaseDate === "string") releaseDates.push(document.releaseDate);

		const platform = downloadPlatformFor(metadataFile);
		const files = Array.isArray(document.files)
			? document.files
			: [{ url: document.path, sha512: document.sha512, size: document.size }];
		for (const file of files) {
			const fileName = referencedFileName(file?.url);
			if (!fileName) continue;
			const format = downloadFormatFor(platform, fileName);
			if (!format) continue;
			const arch = downloadArchFor(metadataFile, fileName);
			const target = `${platform}-${arch}`;
			const current = downloadsByTarget.get(target);
			if (current && downloadPriority(current.format) >= downloadPriority(format)) continue;
			downloadsByTarget.set(target, {
				platform,
				arch,
				format,
				url: file.url,
				...(typeof file.sha512 === "string" ? { sha512: file.sha512 } : {}),
				...(typeof file.size === "number" ? { size: file.size } : {}),
			});
		}
	}
	if (versions.size !== 1) {
		throw new Error("[generate-download-manifest] updater metadata must contain exactly one version");
	}
	if (downloadsByTarget.size === 0) {
		throw new Error("[generate-download-manifest] updater metadata has no website download artifacts");
	}

	const targetOrder = ["mac-arm64", "mac-x64", "windows-x64", "linux-x64", "linux-arm64"];
	const files = [...downloadsByTarget.entries()]
		.sort(([left], [right]) => targetOrder.indexOf(left) - targetOrder.indexOf(right))
		.map(([, file]) => file);
	const document = {
		version: [...versions][0],
		...(releaseDates.length > 0 ? { releaseDate: releaseDates.sort().at(-1) } : {}),
		files,
	};
	await writeFile(join(directory, "downloads.yml"), stringify(document));
	return document;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const manifest = await generateDownloadManifest();
	console.info(`[generate-download-manifest] generated downloads.yml (${manifest.files.length} targets)`);
}
