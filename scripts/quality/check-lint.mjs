/**
 * Run full Biome checks against explicit source roots.
 * Passing the repository root makes Biome's scanner crawl unrelated trees.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { isDirectRun, repoRoot, runBun } from "./lib.mjs";

const PACKAGE_SUBDIRS = ["src", "test"];
const ROOT_TARGETS = ["package.json", "knip.config.ts", "scripts/quality", "packages/coding-agent/examples"];

export function collectBiomeTargets() {
	const targets = [...ROOT_TARGETS];
	const packagesDir = join(repoRoot, "packages");
	for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		for (const subdir of PACKAGE_SUBDIRS) {
			const target = join(packagesDir, entry.name, subdir);
			if (existsSync(target)) targets.push(relative(repoRoot, target));
		}
	}
	return targets.sort();
}

export function main(args = process.argv.slice(2)) {
	return runBun([
		"x",
		"@biomejs/biome",
		"check",
		"--error-on-warnings",
		"--no-errors-on-unmatched",
		...args,
		...collectBiomeTargets(),
	]);
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
