import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import AdmZip from "adm-zip";

const desktopAppDir = join(import.meta.dirname, "..");
export const builtinThemesDir = join(desktopAppDir, "..", "..", "packages", "themes", "builtin");
export const devSystemThemesDir = join(desktopAppDir, ".artifacts", "system-themes");

function readManifest(path) {
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	if (
		manifest === null ||
		typeof manifest !== "object" ||
		typeof manifest.id !== "string" ||
		typeof manifest.version !== "string" ||
		typeof manifest.sdkVersion !== "string" ||
		typeof manifest.entry !== "string"
	) {
		throw new Error(`无效的主题 manifest：${path}`);
	}
	return manifest;
}

function assertArchivePath(entryName, archivePath) {
	const normalized = normalize(entryName).replace(/\\/g, "/");
	if (
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.startsWith("/") ||
		/^[a-zA-Z]:/.test(entryName)
	) {
		throw new Error(`主题归档包含非法路径：${archivePath} -> ${entryName}`);
	}
}

function assertPathInside(root, relativePath, fieldName) {
	const target = resolve(root, relativePath);
	if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
		throw new Error(`主题 ${fieldName} 越出归档目录：${relativePath}`);
	}
	return target;
}

function validateStagedTheme(target, sourceManifest, archivePath) {
	const manifestPath = join(target, "theme.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`主题归档根目录缺少 theme.json：${archivePath}`);
	}
	const manifest = readManifest(manifestPath);
	if (manifest.id !== sourceManifest.id || manifest.version !== sourceManifest.version) {
		throw new Error(`主题归档 manifest 与源码不一致：${archivePath}`);
	}
	if (!existsSync(assertPathInside(target, manifest.entry, "entry"))) {
		throw new Error(`主题归档缺少入口 ${manifest.entry}：${archivePath}`);
	}
	for (const style of Array.isArray(manifest.styles) ? manifest.styles : []) {
		if (typeof style !== "string" || !existsSync(assertPathInside(target, style, "styles"))) {
			throw new Error(`主题归档缺少样式 ${String(style)}：${archivePath}`);
		}
	}
}

export function stageSystemThemesFromArchives(targetDir, logPrefix = "system-themes") {
	rmSync(targetDir, { recursive: true, force: true });
	mkdirSync(targetDir, { recursive: true });
	if (!existsSync(builtinThemesDir)) return 0;

	let count = 0;
	for (const name of readdirSync(builtinThemesDir)) {
		const themeDir = join(builtinThemesDir, name);
		if (!statSync(themeDir).isDirectory() || !existsSync(join(themeDir, "theme.json"))) continue;
		const sourceManifest = readManifest(join(themeDir, "theme.json"));
		if (sourceManifest.id !== name) {
			throw new Error(`[${logPrefix}] 内置主题目录名与 id 不一致：${name} != ${sourceManifest.id}`);
		}
		const archivePath = join(themeDir, "release", `${sourceManifest.id}-${sourceManifest.version}.zip`);
		if (!existsSync(archivePath)) {
			throw new Error(`[${logPrefix}] 缺少主题归档：${archivePath}；请先运行 build:themes`);
		}
		const zip = new AdmZip(archivePath);
		for (const entry of zip.getEntries()) assertArchivePath(entry.entryName, archivePath);
		const target = join(targetDir, sourceManifest.id);
		mkdirSync(target, { recursive: true });
		zip.extractAllTo(target, true);
		validateStagedTheme(target, sourceManifest, archivePath);
		count += 1;
		console.log(`[${logPrefix}] staged ${sourceManifest.id}@${sourceManifest.version}`);
	}
	return count;
}

export function stageSystemThemeManifests(targetDir, logPrefix = "system-themes-dev") {
	rmSync(targetDir, { recursive: true, force: true });
	mkdirSync(targetDir, { recursive: true });
	if (!existsSync(builtinThemesDir)) return 0;

	let count = 0;
	for (const name of readdirSync(builtinThemesDir)) {
		const themeDir = join(builtinThemesDir, name);
		const manifestPath = join(themeDir, "theme.json");
		if (!statSync(themeDir).isDirectory() || !existsSync(manifestPath)) continue;
		const manifest = readManifest(manifestPath);
		if (manifest.id !== name) {
			throw new Error(`[${logPrefix}] 内置主题目录名与 id 不一致：${name} != ${manifest.id}`);
		}
		const target = join(targetDir, manifest.id);
		mkdirSync(target, { recursive: true });
		cpSync(manifestPath, join(target, "theme.json"));
		count += 1;
		console.log(`[${logPrefix}] staged ${manifest.id}@${manifest.version}`);
	}
	return count;
}
