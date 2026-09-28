/** Keep production runtime failures structured and recovery decisions explicit. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, repoRoot, walkFiles } from "./lib.mjs";

const BOUNDARY_ROOTS = [
	"packages/coding-agent/src/rpc",
	"packages/runtime-desktop/src",
	"apps/im-gateway/internal/hostclient",
	"apps/im-gateway/internal/bridge",
	"apps/im-gateway/internal/router",
];

const BOUNDARY_FILES = [
	"apps/cli-host/src/agent-runtime-selection.ts",
	"apps/cli-host/src/extension-compatibility-error.ts",
	"apps/cli-host/src/session-compatibility-error.ts",
	"apps/cli-host/src/rpc/node-rpc-client-transport.ts",
	"apps/desktop/src/main/agent-runtime/composition.ts",
	"apps/desktop/src/main/conversations/desktop-conversation-service.ts",
	"apps/desktop/src/main/runtime.ts",
	"packages/runtime-core/src/errors.ts",
	"packages/runtime-core/src/runtime-host/runtime-host.ts",
	"packages/coding-agent/src/composition/runtime-host-retry.ts",
];

const FORBIDDEN_BOUNDARY_PATTERNS = [
	{
		label: "classifies recovery by JavaScript error message",
		pattern: /(?:error|err)\.message\.(?:includes|match|startsWith|endsWith)\s*\(/,
	},
	{
		label: "classifies recovery by JavaScript error name",
		pattern: /(?:error|err)\.name\s*===/,
	},
	{
		label: "classifies recovery by Go error message",
		pattern: /strings\.(?:Contains|HasPrefix|HasSuffix)\s*\(\s*(?:err|failure)\.Error\(\)/,
	},
	{
		label: "reintroduces automatic Turn replay",
		pattern: /automatic[_ -]?replay|auto[_ -]?replay/i,
	},
	{
		label: "reintroduces the legacy Desktop backend selector",
		pattern: /session-route backend=/,
	},
];

export function findRuntimeFailureContractViolations(files) {
	const violations = [];
	for (const file of files) {
		for (const forbidden of FORBIDDEN_BOUNDARY_PATTERNS) {
			if (forbidden.pattern.test(file.text)) violations.push(`${normalizePath(file.path)}: ${forbidden.label}`);
		}
	}

	return violations;
}

function normalizePath(path) {
	return path.replaceAll("\\", "/");
}

function readCurrentBoundaryFiles() {
	const files = BOUNDARY_ROOTS.flatMap((directory) =>
		walkFiles(join(repoRoot, directory), { extensions: [".ts", ".go"] })
			.filter((path) => !path.endsWith("_test.go") && !path.endsWith(".test.ts"))
			.map((path) => ({ path: normalizePath(path.slice(repoRoot.length + 1)), text: readText(path) })),
	);
	for (const path of BOUNDARY_FILES) files.push({ path, text: readText(join(repoRoot, path)) });
	return files;
}

if (isDirectRun(import.meta.url)) {
	const files = readCurrentBoundaryFiles();
	const violations = findRuntimeFailureContractViolations(files);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[runtime-failure-contract] ${violation}`);
	} else {
		ok(`[runtime-failure-contract] ok (boundary files=${files.length}, violations=0)`);
	}
}
