export function getWorkspaceBuildDependencyNames(manifest) {
	const dependencyNames = new Set();
	const productionDependencies = {
		...manifest.dependencies,
		...manifest.optionalDependencies,
	};
	for (const [name, range] of Object.entries(productionDependencies)) {
		if (typeof range === "string" && range.startsWith("workspace:")) {
			dependencyNames.add(name);
		}
	}

	for (const [name, range] of Object.entries(manifest.devDependencies ?? {})) {
		if (
			typeof range === "string" &&
			range.startsWith("workspace:") &&
			Object.hasOwn(manifest.peerDependencies ?? {}, name)
		) {
			dependencyNames.add(name);
		}
	}

	return [...dependencyNames];
}
