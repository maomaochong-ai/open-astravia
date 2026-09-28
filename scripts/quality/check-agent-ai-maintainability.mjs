/** Enforce the repository-wide top-level import-type convention in Agent and AI. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

export function findAgentAiMaintainabilityViolations(files) {
	const violations = [];
	for (const file of files) {
		const path = file.path.replaceAll("\\", "/");
		if (!path.startsWith("packages/agent/src/") && !path.startsWith("packages/ai/src/")) continue;
		if (/typeof\s+import\s*\(/u.test(file.text)) {
			violations.push(`${path}: inline import type is forbidden; use a top-level import type`);
		}
	}
	return violations;
}

export function collectAgentAiMaintainabilityInput() {
	return ["packages/agent/src", "packages/ai/src"].flatMap((directory) =>
		walkFiles(join(repoRoot, directory), { extensions: [".ts"] }).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
	);
}

if (isDirectRun(import.meta.url)) {
	const files = collectAgentAiMaintainabilityInput();
	const violations = findAgentAiMaintainabilityViolations(files);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[agent-ai-maintainability] ${violation}`);
		process.exitCode = 1;
	} else {
		ok(`[agent-ai-maintainability] ok (${files.length} source files, inline type imports=0)`);
	}
}
