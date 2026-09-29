/** Keep the subagent scheduling kernel free of workspace-package backedges. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const PACKAGE_DIR = "packages/runtime-subagents";
const DEPENDENCY_SECTIONS = Object.freeze([
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
]);
export function findRuntimeSubagentsBoundaryViolations({ manifest }) {
	const violations = [];
	for (const section of DEPENDENCY_SECTIONS) {
		for (const dependency of Object.keys(manifest.content[section] ?? {})) {
			if (!dependency.startsWith("@vetta/")) continue;
			violations.push(`${manifest.path}: ${section} must not declare workspace dependency ${dependency}`);
		}
	}
	return violations;
}

export function collectRuntimeSubagentsBoundaryInput() {
	const packageDirectory = join(repoRoot, PACKAGE_DIR);
	const manifestPath = join(packageDirectory, "package.json");
	return {
		manifest: { path: rel(manifestPath), content: JSON.parse(readText(manifestPath)) },
		files: walkFiles(join(packageDirectory, "src"), { extensions: [".ts"] }).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
	};
}

if (isDirectRun(import.meta.url)) {
	const input = collectRuntimeSubagentsBoundaryInput();
	const violations = findRuntimeSubagentsBoundaryViolations(input);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[runtime-subagents-boundary] ${violation}`);
	} else {
		ok(`[runtime-subagents-boundary] ok (${input.files.length} source files, workspace dependencies=0)`);
	}
}
