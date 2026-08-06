/**
 * Runtime packages are lower-level capability domains. Their production code,
 * tests, configuration, and manifests must not depend on the Coding Agent
 * product composition layer.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

export const INDEPENDENT_RUNTIME_PACKAGES = Object.freeze([
	"packages/runtime-core",
	"packages/runtime-knowledge",
	"packages/runtime-mcp",
	"packages/runtime-storage",
	"packages/runtime-subagents",
	"packages/runtime-telemetry",
	"packages/runtime-tools",
]);

const DEPENDENCY_SECTIONS = Object.freeze([
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
]);

export function findRuntimeCodingAgentIndependenceViolations(input) {
	const violations = [];
	for (const manifest of input.manifests) {
		for (const section of DEPENDENCY_SECTIONS) {
			if (manifest.content[section]?.["@vetta/coding-agent"] === undefined) continue;
			violations.push(`${manifest.path}: ${section} must not declare @vetta/coding-agent`);
		}
	}
	for (const file of input.files) {
		for (const [index, line] of file.text.split(/\r?\n/u).entries()) {
			if (!line.includes("@vetta/coding-agent")) continue;
			violations.push(`${file.path}:${index + 1}: Runtime package file depends on @vetta/coding-agent`);
		}
	}
	return violations;
}

export function collectRuntimeCodingAgentIndependenceInput() {
	const manifests = [];
	const files = [];
	for (const packageDir of INDEPENDENT_RUNTIME_PACKAGES) {
		const manifestPath = join(repoRoot, packageDir, "package.json");
		if (existsSync(manifestPath)) {
			manifests.push({ path: rel(manifestPath), content: JSON.parse(readText(manifestPath)) });
		}
		for (const filePath of walkFiles(join(repoRoot, packageDir))) {
			files.push({ path: rel(filePath), text: readText(filePath) });
		}
	}
	return { manifests, files };
}

if (isDirectRun(import.meta.url)) {
	const input = collectRuntimeCodingAgentIndependenceInput();
	const violations = findRuntimeCodingAgentIndependenceViolations(input);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[runtime-independence] ${violation}`);
	} else {
		ok(
			`[runtime-independence] ok (${input.manifests.length} manifests, ${input.files.length} code/config files, Coding Agent dependencies=0)`,
		);
	}
}
