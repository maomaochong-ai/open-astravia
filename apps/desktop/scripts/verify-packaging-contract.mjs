import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DESKTOP_BUILD_OUTPUTS, DESKTOP_REQUIRED_SOURCE_FILES } from "./desktop-packaging-layout.mjs";
import { resolveMainBundleExternals, resolvePackagedNativeDependencies } from "./packaged-native-dependencies.mjs";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..", "..");

export function findDesktopPackagingContractViolations(rootDirectory = repoRoot) {
	const violations = [];
	const packageRoot = join(rootDirectory, "apps", "desktop");

	for (const relativePath of DESKTOP_REQUIRED_SOURCE_FILES) {
		if (!existsSync(join(packageRoot, relativePath))) {
			violations.push(`missing Desktop source entry: ${relativePath}`);
		}
	}

	const targets = new Set();
	for (const { source, target } of DESKTOP_BUILD_OUTPUTS) {
		if (targets.has(target)) violations.push(`duplicate Desktop staging target: ${target}`);
		targets.add(target);
		if (!source.startsWith("dist/")) violations.push(`Desktop build output must come from dist/: ${source}`);
	}

	const preparePack = readFileSync(join(packageRoot, "scripts", "prepare-pack.js"), "utf8");
	if (!preparePack.includes('from "./desktop-packaging-layout.mjs"')) {
		violations.push("prepare-pack.js does not consume the shared Desktop packaging layout");
	}

	const remoteHost = readFileSync(
		join(packageRoot, "src", "main", "remote-control", "desktop-remote-desktop-host.ts"),
		"utf8",
	);
	if (/options\.appRoot[^\n]*["']dist\/(?:preload|renderer)/.test(remoteHost)) {
		violations.push("packaged remote desktop host resolves a resource through appRoot/dist");
	}

	const desktopPackage = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	const declaredDependencies = new Set([
		...Object.keys(desktopPackage.dependencies ?? {}),
		...Object.keys(desktopPackage.optionalDependencies ?? {}),
		...Object.keys(desktopPackage.devDependencies ?? {}),
	]);
	for (const dependency of resolveMainBundleExternals()) {
		if (!declaredDependencies.has(dependency)) {
			violations.push(`main external dependency is not declared by apps/desktop: ${dependency}`);
		}
	}

	const stagedDependencies = new Set();
	for (const platform of ["darwin", "win32", "linux"]) {
		const result = resolvePackagedNativeDependencies(new Set([platform]));
		for (const dependency of [...result.required, ...result.optional]) stagedDependencies.add(dependency);
	}
	for (const dependency of resolveMainBundleExternals()) {
		if (!stagedDependencies.has(dependency)) {
			violations.push(`main external dependency is never staged: ${dependency}`);
		}
	}

	return violations;
}

export function main() {
	const violations = findDesktopPackagingContractViolations();
	if (violations.length > 0) {
		console.error(`[desktop-packaging-contract] ${violations.length} violation(s)`);
		for (const violation of violations) console.error(`- ${violation}`);
		process.exitCode = 1;
	} else {
		console.log("[desktop-packaging-contract] ok");
	}
	return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
