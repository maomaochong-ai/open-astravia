/** Keep the subagent runtime independent from product and tool-protocol concerns. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const PACKAGE_DIR = "packages/runtime-subagents";
const DEPENDENCY_SECTIONS = Object.freeze([
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
]);
const FORBIDDEN_SOURCE_TOKENS = Object.freeze([
	"@vetta/coding-agent",
	"@vetta/runtime-core",
	"@vetta/runtime-tools",
	"SubagentNotificationPayload",
	"buildSubagentNotification",
	"describeForTools",
	"dispatch_workflows",
	"followup_task",
	"spawn_agent",
	"typeDocs",
	"wait_agent",
]);
const REQUIRED_OWNER_FILES = Object.freeze([
	"packages/runtime-subagents/src/subagent-dispatcher.ts",
	"packages/runtime-subagents/src/subagent-pool.ts",
	"packages/runtime-subagents/src/subagent-run.ts",
	"packages/runtime-subagents/src/recovery.ts",
]);
const RETIRED_OWNER_FILES = Object.freeze([
	"packages/runtime-subagents/src/internal.ts",
	"packages/runtime-subagents/src/scheduler.ts",
	"packages/runtime-subagents/src/subagent-store.ts",
]);
const COORDINATOR_FORBIDDEN_TOKENS = Object.freeze([
	"SubagentChildHandle",
	"MutableSubagentSnapshot",
	"snapshot.status =",
	"snapshot.generation +=",
	"handle.prompt(",
	"handle.abort(",
]);

export function findRuntimeSubagentsBoundaryViolations({ manifest, files }) {
	const violations = [];
	const paths = new Set(files.map((file) => file.path.replaceAll("\\", "/")));
	for (const section of DEPENDENCY_SECTIONS) {
		for (const dependency of Object.keys(manifest.content[section] ?? {})) {
			if (!dependency.startsWith("@vetta/")) continue;
			violations.push(`${manifest.path}: ${section} must not declare workspace dependency ${dependency}`);
		}
	}
	for (const file of files) {
		const normalizedPath = file.path.replaceAll("\\", "/");
		for (const [index, line] of file.text.split(/\r?\n/u).entries()) {
			for (const token of FORBIDDEN_SOURCE_TOKENS) {
				if (!line.includes(token)) continue;
				violations.push(`${file.path}:${index + 1}: forbidden subagent kernel token ${token}`);
			}
			if (normalizedPath === "packages/runtime-subagents/src/coordinator.ts") {
				for (const token of COORDINATOR_FORBIDDEN_TOKENS) {
					if (!line.includes(token)) continue;
					violations.push(`${file.path}:${index + 1}: coordinator must not own ${token}`);
				}
			}
		}
	}
	for (const required of REQUIRED_OWNER_FILES) {
		if (!paths.has(required)) violations.push(`${required}: required runtime-subagents owner file is missing`);
	}
	for (const retired of RETIRED_OWNER_FILES) {
		if (paths.has(retired)) violations.push(`${retired}: retired runtime-subagents owner file still exists`);
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
		ok(
			`[runtime-subagents-boundary] ok (${input.files.length} source files, workspace dependencies=0, tool protocol tokens=0)`,
		);
	}
}
