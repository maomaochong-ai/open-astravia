/**
 * Root tsconfig path maps must explicitly point every workspace TypeScript
 * package.json export at source. `check` typechecks a clean tree without dist;
 * Node16 + tsgo will not treat `@scope/pkg/sub` -> `src/sub` as `src/sub/index.ts`,
 * and package.json exports only name dist/*.d.ts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./lib.mjs";

const WORKSPACE_ROOTS = ["packages", "apps"];

export function typesExportToSourceRel(typesPath) {
	const normalized = typesPath.replaceAll("\\", "/");
	if (!normalized.startsWith("./dist/") || !normalized.endsWith(".d.ts")) return null;
	return `src/${normalized.slice("./dist/".length, -".d.ts".length)}.ts`;
}

export function collectTypeScriptExportEntries(pkg) {
	if (!pkg?.name || !pkg.exports || typeof pkg.exports !== "object" || Array.isArray(pkg.exports)) {
		return [];
	}

	const entries = [];
	for (const [key, value] of Object.entries(pkg.exports)) {
		if (key.includes("*") || key.endsWith(".css")) continue;
		const types = typeof value === "string" ? value : value && typeof value === "object" ? value.types : undefined;
		if (typeof types !== "string" || !types.endsWith(".d.ts")) continue;
		const sourceRel = typesExportToSourceRel(types);
		if (!sourceRel) continue;
		const specifier = key === "." ? pkg.name : `${pkg.name}${key.slice(1)}`;
		entries.push({ specifier, sourceRel, types });
	}
	return entries;
}

export function findSourcePathMapViolations({ paths, packages, fileExists = existsSync }) {
	const violations = [];
	for (const workspacePackage of packages) {
		for (const entry of collectTypeScriptExportEntries(workspacePackage.manifest)) {
			const expectedTarget = `./${workspacePackage.dir}/${entry.sourceRel}`.replaceAll("\\", "/");
			const mapped = paths[entry.specifier];
			if (!mapped) {
				violations.push(
					`${entry.specifier}: root tsconfig.json is missing an explicit source path map to ${expectedTarget}`,
				);
				continue;
			}
			const target = Array.isArray(mapped) ? mapped[0] : mapped;
			if (target !== expectedTarget) {
				violations.push(`${entry.specifier}: path map is ${target}, expected ${expectedTarget}`);
				continue;
			}
			if (!fileExists(expectedTarget.slice(2))) {
				violations.push(`${entry.specifier}: mapped source file is missing: ${expectedTarget}`);
			}
		}
	}
	return violations;
}

function resolvePathMapTarget(paths, specifier) {
	const exact = paths[specifier];
	if (exact) return Array.isArray(exact) ? exact[0] : exact;

	for (const [pattern, value] of Object.entries(paths)) {
		const wildcard = pattern.indexOf("*");
		if (wildcard < 0) continue;
		const prefix = pattern.slice(0, wildcard);
		const suffix = pattern.slice(wildcard + 1);
		if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
		const captured = specifier.slice(prefix.length, specifier.length - suffix.length);
		const target = Array.isArray(value) ? value[0] : value;
		return typeof target === "string" ? target.replace("*", captured) : undefined;
	}
	return undefined;
}

function pathMapTargetResolvesToSource(mappedTarget, expectedTarget) {
	if (!mappedTarget) return false;
	const candidates = new Set([
		expectedTarget,
		expectedTarget.endsWith(".ts") ? expectedTarget.slice(0, -3) : expectedTarget,
		expectedTarget.endsWith("/index.ts") ? expectedTarget.slice(0, -"/index.ts".length) : expectedTarget,
	]);
	return candidates.has(mappedTarget);
}

export function findImportedSourcePathMapViolations({ paths, importedSpecifiers, packages, configDir }) {
	const exportsBySpecifier = new Map();
	for (const workspacePackage of packages) {
		for (const entry of collectTypeScriptExportEntries(workspacePackage.manifest)) {
			exportsBySpecifier.set(entry.specifier, { ...entry, packageDir: workspacePackage.dir });
		}
	}

	const violations = [];
	for (const specifier of [...new Set(importedSpecifiers)].sort()) {
		const entry = exportsBySpecifier.get(specifier);
		if (!entry) continue;
		const relativeTarget = relative(configDir, join(entry.packageDir, entry.sourceRel)).replaceAll("\\", "/");
		const expectedTarget = relativeTarget.startsWith(".") ? relativeTarget : `./${relativeTarget}`;
		const mappedTarget = resolvePathMapTarget(paths, specifier)?.replaceAll("\\", "/");
		if (!pathMapTargetResolvesToSource(mappedTarget, expectedTarget)) {
			violations.push(
				`${specifier}: ${configDir}/tsconfig.json maps to ${mappedTarget ?? "(missing)"}, expected ${expectedTarget}`,
			);
		}
	}
	return violations;
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function collectWorkspacePackages(rootPath) {
	const packages = [];

	const visit = (directory, relativeDir) => {
		for (const name of readdirSync(directory)) {
			if (name === "node_modules" || name === "dist" || name === "release") continue;
			const absolute = join(directory, name);
			if (!statSync(absolute).isDirectory()) continue;
			const manifestPath = join(absolute, "package.json");
			const nextRelative = relativeDir ? `${relativeDir}/${name}` : name;
			if (existsSync(manifestPath)) {
				packages.push({
					dir: nextRelative.replaceAll("\\", "/"),
					manifest: readJson(manifestPath),
				});
			}
			visit(absolute, nextRelative);
		}
	};

	for (const workspaceRoot of WORKSPACE_ROOTS) {
		const absoluteRoot = join(rootPath, workspaceRoot);
		if (existsSync(absoluteRoot)) visit(absoluteRoot, workspaceRoot);
	}
	return packages;
}

function collectModuleSpecifiers(directory) {
	const specifiers = [];
	const visit = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (["node_modules", "dist", "release", "e2e"].includes(entry.name)) continue;
			const absolute = join(current, entry.name);
			if (entry.isDirectory()) {
				visit(absolute);
				continue;
			}
			if (!/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) continue;
			const source = readFileSync(absolute, "utf8");
			const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["']([^"']+)["']/g;
			for (const match of source.matchAll(importPattern)) specifiers.push(match[1]);
		}
	};
	visit(directory);
	return specifiers;
}

export function checkSourcePathMaps(rootPath = repoRoot) {
	const tsconfig = readJson(join(rootPath, "tsconfig.json"));
	const packages = collectWorkspacePackages(rootPath);
	const rootViolations = findSourcePathMapViolations({
		paths: tsconfig.compilerOptions?.paths ?? {},
		packages,
		fileExists: (relativePath) => existsSync(join(rootPath, relativePath)),
	});
	const desktopDir = "apps/desktop";
	const desktopTsconfig = readJson(join(rootPath, desktopDir, "tsconfig.json"));
	const desktopViolations = findImportedSourcePathMapViolations({
		paths: desktopTsconfig.compilerOptions?.paths ?? {},
		importedSpecifiers: collectModuleSpecifiers(join(rootPath, desktopDir)),
		packages,
		configDir: desktopDir,
	});
	return [...rootViolations, ...desktopViolations];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const violations = checkSourcePathMaps();
	if (violations.length > 0) {
		console.error(violations.join("\n"));
		process.exitCode = 1;
	} else {
		console.log("[source-path-maps] ok");
	}
}
