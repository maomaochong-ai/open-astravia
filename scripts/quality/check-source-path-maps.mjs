/**
 * Root tsconfig path maps must explicitly point every workspace TypeScript
 * package.json export at source. `check` typechecks a clean tree without dist;
 * Node16 + tsgo will not treat `@scope/pkg/sub` -> `src/sub` as `src/sub/index.ts`,
 * and package.json exports only name dist/*.d.ts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function collectWorkspacePackages(rootPath) {
	const packages = [];

	const visit = (directory, relativeDir) => {
		for (const name of readdirSync(directory)) {
			if (name === "node_modules" || name === "dist") continue;
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

export function checkSourcePathMaps(rootPath = repoRoot) {
	const tsconfig = readJson(join(rootPath, "tsconfig.json"));
	return findSourcePathMapViolations({
		paths: tsconfig.compilerOptions?.paths ?? {},
		packages: collectWorkspacePackages(rootPath),
		fileExists: (relativePath) => existsSync(join(rootPath, relativePath)),
	});
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
