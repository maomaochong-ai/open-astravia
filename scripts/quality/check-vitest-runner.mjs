/**
 * Require package.json Vitest scripts to launch through Node via
 * scripts/quality/run-vitest.mjs. Bun workers on Windows fail before
 * collecting tests (forks: File URL path must be an absolute path;
 * threads: port.addListener is not a function).
 *
 * Usage:
 *   bun run scripts/quality/check-vitest-runner.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isDirectRun, repoRoot } from "./lib.mjs";

const WRAPPER_MARKER = "scripts/quality/run-vitest.mjs";
const DIRECT_VITEST = /(?:^|[\s;&|])(?:bunx\s+|npx\s+)?vitest(?:\s|$)/;
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	".git",
	"coverage",
	"out",
	"build",
	".turbo",
	".cache",
	"release",
	"releases",
]);

export function isDirectVitestCommand(command) {
	if (typeof command !== "string") return false;
	if (command.includes(WRAPPER_MARKER)) return false;
	return DIRECT_VITEST.test(command);
}

export function findDirectVitestInvocations(scripts) {
	const violations = [];
	for (const [name, command] of Object.entries(scripts ?? {})) {
		if (isDirectVitestCommand(command)) {
			violations.push({ script: name, command });
		}
	}
	return violations;
}

export function findVitestRunnerViolations(manifestPath, manifest) {
	return findDirectVitestInvocations(manifest?.scripts).map(
		({ script, command }) =>
			`${manifestPath}: script "${script}" 必须通过 ${WRAPPER_MARKER} 启动 Vitest，不能直接执行 ${JSON.stringify(command)}`,
	);
}

function collectPackageManifests(rootPath) {
	const files = [join(rootPath, "package.json")];
	const stack = [join(rootPath, "packages"), join(rootPath, "apps")];
	while (stack.length > 0) {
		const current = stack.pop();
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				stack.push(full);
				continue;
			}
			if (entry.name === "package.json") files.push(full);
		}
	}
	return files;
}

export function checkVitestRunner(rootPath = repoRoot) {
	const violations = [];
	for (const absolute of collectPackageManifests(rootPath)) {
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(absolute, "utf8"));
		} catch {
			continue;
		}
		const manifestPath = relative(rootPath, absolute).replaceAll("\\", "/");
		violations.push(...findVitestRunnerViolations(manifestPath, manifest));
	}
	return violations;
}

if (isDirectRun(import.meta.url)) {
	const violations = checkVitestRunner();
	if (violations.length > 0) {
		console.error(violations.join("\n"));
		process.exitCode = 1;
	} else {
		console.log("[vitest-runner] ok");
	}
}
