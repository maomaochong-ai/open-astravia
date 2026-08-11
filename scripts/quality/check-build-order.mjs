/**
 * Ensure scripts/build.sh builds workspace production dependencies first.
 *
 * Dev dependencies are intentionally excluded: package build configs compile
 * production sources only, and including test-only edges would create false
 * cycles such as runtime-core -> coding-agent.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	workspaceLayers as desktopWorkspaceLayers,
	workspacePackages as desktopWorkspacePackages,
} from "../../packages/desktop-app/scripts/build-workspace-prereqs.mjs";
import { fail, isDirectRun, ok, repoRoot } from "./lib.mjs";

const BUILD_PACKAGE_PATTERN = /^\s*build_pkg(?:_script)?\s+(packages\/[A-Za-z0-9_./-]+)/gm;

export function parseBuildPackageOrder(source) {
	const order = [];
	const seen = new Set();
	for (const match of source.matchAll(BUILD_PACKAGE_PATTERN)) {
		const packageDir = match[1];
		if (!packageDir || seen.has(packageDir)) continue;
		seen.add(packageDir);
		order.push(packageDir);
	}
	return order;
}

export function findBuildOrderViolations(buildOrder, manifests) {
	const orderIndex = new Map(buildOrder.map((packageDir, index) => [packageDir, index]));
	const manifestsByName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
	const violations = [];

	for (const manifest of manifests) {
		const consumerIndex = orderIndex.get(manifest.dir);
		if (consumerIndex === undefined) continue;
		const productionDependencies = {
			...manifest.dependencies,
			...manifest.optionalDependencies,
		};
		for (const [dependencyName, range] of Object.entries(productionDependencies)) {
			if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
			const dependency = manifestsByName.get(dependencyName);
			if (!dependency) continue;
			const dependencyIndex = orderIndex.get(dependency.dir);
			if (dependencyIndex === undefined || dependencyIndex < consumerIndex) continue;
			violations.push(`${manifest.dir} is built before its workspace dependency ${dependency.dir}`);
		}
	}

	return violations;
}

export function findLayeredBuildOrderViolations(packageConfigs, layers, manifests) {
	const layerByKey = new Map();
	const violations = [];
	for (const [layerIndex, layer] of layers.entries()) {
		for (const key of layer) {
			if (layerByKey.has(key)) {
				violations.push(`package ${key} appears in more than one build layer`);
				continue;
			}
			layerByKey.set(key, layerIndex);
		}
	}

	const keysByPackageName = new Map(
		Object.entries(packageConfigs).map(([key, config]) => {
			const manifest = manifests.find((candidate) => candidate.dir === config.dir);
			return [manifest?.name, key];
		}),
	);
	for (const [key, config] of Object.entries(packageConfigs)) {
		const consumerLayer = layerByKey.get(key);
		if (consumerLayer === undefined) {
			violations.push(`package ${key} is missing from the build layers`);
			continue;
		}
		const manifest = manifests.find((candidate) => candidate.dir === config.dir);
		if (!manifest) {
			violations.push(`package ${key} is missing manifest metadata`);
			continue;
		}
		const productionDependencies = {
			...manifest.dependencies,
			...manifest.optionalDependencies,
		};
		for (const [dependencyName, range] of Object.entries(productionDependencies)) {
			if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
			const dependencyKey = keysByPackageName.get(dependencyName);
			if (!dependencyKey) {
				violations.push(`${key} workspace dependency ${dependencyName} is missing from package configs`);
				continue;
			}
			const dependencyLayer = layerByKey.get(dependencyKey);
			if (dependencyLayer !== undefined && dependencyLayer < consumerLayer) continue;
			violations.push(`${key} is not in a later build layer than its workspace dependency ${dependencyKey}`);
		}
	}

	return violations;
}

export function main() {
	const buildScript = readFileSync(join(repoRoot, "scripts/build.sh"), "utf8");
	const buildOrder = parseBuildPackageOrder(buildScript);
	const manifests = buildOrder.map(readManifest);
	const desktopManifests = Object.values(desktopWorkspacePackages).map(({ dir }) => readManifest(dir));
	const violations = [
		...findBuildOrderViolations(buildOrder, manifests).map((violation) => `scripts/build.sh: ${violation}`),
		...findLayeredBuildOrderViolations(desktopWorkspacePackages, desktopWorkspaceLayers, desktopManifests).map(
			(violation) => `desktop workspace prereqs: ${violation}`,
		),
	];

	if (violations.length === 0) {
		ok(
			`[build-order] ok (${buildOrder.length} root package(s), ${desktopManifests.length} desktop prerequisite package(s))`,
		);
		return 0;
	}
	for (const violation of violations) {
		fail(`[build-order] ${violation}`);
	}
	fail(`[build-order] ${violations.length} violation(s)`);
	return 1;
}

function readManifest(packageDir) {
	const json = JSON.parse(readFileSync(join(repoRoot, packageDir, "package.json"), "utf8"));
	return {
		dir: packageDir,
		name: json.name,
		dependencies: json.dependencies,
		optionalDependencies: json.optionalDependencies,
		peerDependencies: json.peerDependencies,
	};
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
