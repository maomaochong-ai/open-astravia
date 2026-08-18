import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import AdmZip from "adm-zip";

const desktopAppDir = join(import.meta.dirname, "..");
export const presetsDir = join(desktopAppDir, "..", "..", "packages", "plugins", "presets");
export const tenantsConfigPath = join(desktopAppDir, "..", "..", "packages", "plugins", "tenants.json");
export const devSystemPluginsDir = join(desktopAppDir, ".artifacts", "system-plugins");

// 解析当前构建/开发使用的租户与系统插件 profile，返回应打包的插件 id 集合。
// 租户由 VETTA_TENANT 指定，profile 由 VETTA_SYSTEM_PLUGIN_PROFILE 指定；
// 两者缺省时分别取 tenants.json 的 default / defaultProfile。
// 无 tenants.json 时返回 pluginIds=null，表示不过滤（打包全部 preset），保持向后兼容。
export function resolveSystemPluginSelection(explicitTenant, explicitProfile) {
	const requestedTenant = explicitTenant ?? process.env.VETTA_TENANT ?? undefined;
	const requestedProfile =
		explicitProfile ?? process.env.VETTA_SYSTEM_PLUGIN_PROFILE ?? undefined;

	let config = null;
	try {
		config = JSON.parse(readFileSync(tenantsConfigPath, "utf8"));
	} catch {
		config = null;
	}
	if (config === null || typeof config !== "object" || typeof config.profiles !== "object") {
		if (requestedTenant || requestedProfile) {
			throw new Error(
				`指定了系统插件租户/profile，但缺少有效的 tenants.json：${tenantsConfigPath}`,
			);
		}
		return { name: null, profile: null, pluginIds: null };
	}

	const profile = requestedProfile ?? config.defaultProfile ?? "development";
	const profileTenants = config.profiles[profile];
	if (profileTenants === null || typeof profileTenants !== "object" || Array.isArray(profileTenants)) {
		const known = Object.keys(config.profiles).join(", ") || "(空)";
		throw new Error(`未知系统插件 profile：${profile}；tenants.json 已定义：${known}`);
	}

	const name = requestedTenant ?? config.default ?? "common";
	const list = profileTenants[name];
	if (!Array.isArray(list)) {
		const known = Object.keys(profileTenants).join(", ") || "(空)";
		throw new Error(`profile ${profile} 中的未知租户：${name}；tenants.json 已定义：${known}`);
	}
	return { name, profile, pluginIds: new Set(list) };
}

function readManifest(path) {
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	if (
		manifest === null ||
		typeof manifest !== "object" ||
		typeof manifest.id !== "string" ||
		typeof manifest.version !== "string" ||
		typeof manifest.entry !== "string"
	) {
		throw new Error(`无效的插件 manifest：${path}`);
	}
	return manifest;
}

function validateArchiveEntry(entryName, archivePath) {
	const normalized = normalize(entryName).replace(/\\/g, "/");
	if (
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.startsWith("/") ||
		/^[a-zA-Z]:/.test(entryName)
	) {
		throw new Error(`插件归档包含非法路径：${archivePath} -> ${entryName}`);
	}
}

function assertPathInside(root, relativePath, fieldName) {
	const target = resolve(root, relativePath);
	if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
		throw new Error(`插件 ${fieldName} 越出归档目录：${relativePath}`);
	}
	return target;
}

function validateStagedPlugin(target, sourceManifest, archivePath) {
	const stagedManifestPath = join(target, "plugin.json");
	if (!existsSync(stagedManifestPath)) {
		throw new Error(`插件归档根目录缺少 plugin.json：${archivePath}`);
	}
	const stagedManifest = readManifest(stagedManifestPath);
	if (stagedManifest.id !== sourceManifest.id || stagedManifest.version !== sourceManifest.version) {
		throw new Error(`插件归档 manifest 与源码不一致：${archivePath}`);
	}

	const entryPath = assertPathInside(target, stagedManifest.entry, "entry");
	if (!existsSync(entryPath)) {
		throw new Error(`插件归档缺少入口 ${stagedManifest.entry}：${archivePath}`);
	}
	for (const style of Array.isArray(stagedManifest.styles) ? stagedManifest.styles : []) {
		if (typeof style !== "string" || !existsSync(assertPathInside(target, style, "styles"))) {
			throw new Error(`插件归档缺少样式 ${String(style)}：${archivePath}`);
		}
	}
}

export function isSystemPluginStaged(targetDir, pluginId) {
	const pluginDir = join(presetsDir, pluginId);
	const sourceManifestPath = join(pluginDir, "plugin.json");
	const target = join(targetDir, pluginId);
	if (!existsSync(sourceManifestPath) || !existsSync(target)) return false;

	try {
		const sourceManifest = readManifest(sourceManifestPath);
		validateStagedPlugin(target, sourceManifest, target);
		return true;
	} catch {
		return false;
	}
}

export function stageSystemPluginsFromArchives(targetDir, logPrefix = "system-plugins", options = {}) {
	const selectedPluginIds =
		options.pluginIds === undefined ? undefined : new Set(options.pluginIds);
	// preserveTarget 模式下应保留的插件集合（通常为当前租户的全部插件）。
	// 不传则保留全部 preset；不在该集合内的已 staging 插件会被清理（如切换租户后）。
	const keepPluginIds =
		options.keepPluginIds === undefined ? undefined : new Set(options.keepPluginIds);
	const preserveTarget = options.preserveTarget === true;

	if (!preserveTarget) {
		rmSync(targetDir, { recursive: true, force: true });
	}
	mkdirSync(targetDir, { recursive: true });

	if (!existsSync(presetsDir)) {
		console.warn(`[${logPrefix}] 无 presets 目录，跳过：${presetsDir}`);
		return 0;
	}

	const presetNames = new Set(
		readdirSync(presetsDir).filter((name) => {
			const pluginDir = join(presetsDir, name);
			return statSync(pluginDir).isDirectory() && existsSync(join(pluginDir, "plugin.json"));
		}),
	);
	if (preserveTarget) {
		for (const name of readdirSync(targetDir)) {
			const target = join(targetDir, name);
			if (!statSync(target).isDirectory()) continue;
			const keep = presetNames.has(name) && (keepPluginIds === undefined || keepPluginIds.has(name));
			if (!keep) {
				rmSync(target, { recursive: true, force: true });
				console.log(`[${logPrefix}] removed stale ${name}`);
			}
		}
	}

	let count = 0;
	for (const name of presetNames) {
		if (selectedPluginIds && !selectedPluginIds.has(name)) continue;

		const pluginDir = join(presetsDir, name);
		const sourceManifestPath = join(pluginDir, "plugin.json");

		const sourceManifest = readManifest(sourceManifestPath);
		if (sourceManifest.id !== name) {
			throw new Error(`[${logPrefix}] preset 目录名与插件 id 不一致：${name} != ${sourceManifest.id}`);
		}

		const archivePath = join(pluginDir, "release", `${sourceManifest.id}-${sourceManifest.version}.zip`);
		if (!existsSync(archivePath)) {
			throw new Error(`[${logPrefix}] 缺少插件归档：${archivePath}；请先运行 build:presets`);
		}

		const zip = new AdmZip(archivePath);
		for (const entry of zip.getEntries()) {
			validateArchiveEntry(entry.entryName, archivePath);
		}

		const target = join(targetDir, sourceManifest.id);
		rmSync(target, { recursive: true, force: true });
		mkdirSync(target, { recursive: true });
		zip.extractAllTo(target, true);

		validateStagedPlugin(target, sourceManifest, archivePath);

		count += 1;
		console.log(`[${logPrefix}] staged ${sourceManifest.id}@${sourceManifest.version} <- ${archivePath}`);
	}

	console.log(`[${logPrefix}] 完成，本次 staging ${count} 个系统插件`);
	return count;
}
