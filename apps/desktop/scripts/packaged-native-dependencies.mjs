/**
 * 主进程 bundle 之外的运行时依赖，唯一事实源。
 *
 * 这里的每个包都必须同时满足两件事，缺一个都会在打包产物里炸：
 * 1. 被 Vite 标成 external（不进 bundle）；
 * 2. 被 prepare-pack 复制进 staging/node_modules 并写入 staged package.json 的
 *    dependencies，否则 app.asar 里根本没有这个包，主进程一 import 就是
 *    ERR_MODULE_NOT_FOUND，应用直接起不来。
 *
 * 以前这两份清单分别写在 vite.main.config.ts 和本文件里靠注释「保持同步」，
 * 结果新增 external 时漏掉 staging 就成了必然（ws 即如此）。现在两边都从这里读。
 */

const DEFINITIONS = [
	{ name: "@silvia-odwyer/photon-node", platforms: "all", unpack: true },
	{ name: "builder-util-runtime", platforms: "all", unpack: false },
	{ name: "electron-updater", platforms: "all", unpack: false },
	{ name: "uiohook-napi", platforms: "all", unpack: true },
	{ name: "electron-liquid-glass", platforms: ["darwin"], unpack: true, optional: true },
	{ name: "sherpa-onnx-win-x64", platforms: ["win32"], unpack: true, feature: "speech-input" },
	// 远程接入的中继连接（desktop-websocket）在主进程顶层静态 import，必须随包分发。
	// 纯 JS，无平台差异，也不需要 unpack。
	{ name: "ws", platforms: "all", unpack: false },
	// Windows 远程输入注入通过 koffi 调用 user32.dll：原生模块（dlopen），必须 unpack。
	// 只有 win32 产物会走到这条路径（createRequire 懒加载）。
	{ name: "koffi", platforms: ["win32"], unpack: true },
];

function matchesPlatform(definition, platformFamilies) {
	return definition.platforms === "all" || definition.platforms.some((platform) => platformFamilies.has(platform));
}

function matchesFeature(definition, speechInputEnabled) {
	return definition.feature !== "speech-input" || speechInputEnabled;
}

/**
 * Resolve runtime dependencies from target platforms, never from the build host.
 * This keeps cross-built artifacts free of native libraries for other systems.
 */
export function resolvePackagedNativeDependencies(platformFamilies, { speechInputEnabled = true } = {}) {
	const selected = DEFINITIONS.filter(
		(definition) =>
			matchesPlatform(definition, platformFamilies) && matchesFeature(definition, speechInputEnabled),
	);
	return {
		required: selected.filter((definition) => !definition.optional).map((definition) => definition.name),
		optional: selected.filter((definition) => definition.optional).map((definition) => definition.name),
		asarUnpack: selected
			.filter((definition) => definition.unpack)
			.map((definition) => `node_modules/${definition.name}/**/*`),
	};
}

/**
 * Vite 主进程构建要标成 external 的包名。
 *
 * 与 staging 不同，这里**不按平台过滤**：bundle 只构建一份，平台专属的包
 * （glass / sherpa / koffi）在代码里是懒加载或平台分支，标成 external 后
 * 非目标平台的产物只是没有这个包，不会被 import 到。按平台过滤反而会把它们
 * 打进 bundle，在解析原生模块时直接构建失败。
 */
export function resolveMainBundleExternals({ speechInputEnabled = true } = {}) {
	return DEFINITIONS.filter((definition) => matchesFeature(definition, speechInputEnabled)).map(
		(definition) => definition.name,
	);
}
