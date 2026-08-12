const DEFINITIONS = [
	{ name: "@silvia-odwyer/photon-node", platforms: "all", unpack: true },
	{ name: "builder-util-runtime", platforms: "all", unpack: false },
	{ name: "electron-updater", platforms: "all", unpack: false },
	{ name: "uiohook-napi", platforms: "all", unpack: true },
	{ name: "electron-liquid-glass", platforms: ["darwin"], unpack: true, optional: true },
	{ name: "sherpa-onnx-win-x64", platforms: ["win32"], unpack: true },
];

function matchesPlatform(definition, platformFamilies) {
	return definition.platforms === "all" || definition.platforms.some((platform) => platformFamilies.has(platform));
}

/**
 * Resolve runtime dependencies from target platforms, never from the build host.
 * This keeps cross-built artifacts free of native libraries for other systems.
 */
export function resolvePackagedNativeDependencies(platformFamilies) {
	const selected = DEFINITIONS.filter((definition) => matchesPlatform(definition, platformFamilies));
	return {
		required: selected.filter((definition) => !definition.optional).map((definition) => definition.name),
		optional: selected.filter((definition) => definition.optional).map((definition) => definition.name),
		asarUnpack: selected
			.filter((definition) => definition.unpack)
			.map((definition) => `node_modules/${definition.name}/**/*`),
	};
}
