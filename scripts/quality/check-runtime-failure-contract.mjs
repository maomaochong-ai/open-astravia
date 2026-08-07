/** Keep production runtime failures structured and recovery decisions explicit. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, repoRoot, walkFiles } from "./lib.mjs";

export const REQUIRED_RUNTIME_FAILURE_MARKERS = Object.freeze({
	"packages/coding-agent/src/modes/rpc/rpc-failure.ts": [
		"RpcFailureMetadataSchema",
		'"retry_safe"',
		'"continue_session"',
		'"restart_session"',
		'"user_action"',
		'"fatal"',
	],
	"packages/coding-agent/src/modes/rpc/rpc-types.ts": ["RpcFailureMetadata"],
	"packages/cli-app/src/session-compatibility-error.ts": ["recoverability"],
	"packages/desktop-app/src/main/greenfield-runtime/desktop-runtime-lifecycle.ts": [
		"DesktopRuntimeFailure",
		"DesktopRuntimeHealth",
	],
	"packages/im-gateway/internal/hostclient/types.go": [
		"type TypedFailure interface",
		"FailureRecoverability() FailureRecoverability",
	],
});

const BOUNDARY_ROOTS = ["packages/coding-agent/src/modes/rpc", "packages/im-gateway/internal/hostclient"];

const BOUNDARY_FILES = [
	"packages/cli-app/src/agent-runtime-selection.ts",
	"packages/cli-app/src/extension-compatibility-error.ts",
	"packages/cli-app/src/session-compatibility-error.ts",
	"packages/desktop-app/src/main/greenfield-runtime/desktop-runtime-composition.ts",
	"packages/desktop-app/src/main/greenfield-runtime/desktop-runtime-lifecycle.ts",
	"packages/desktop-app/src/main/runtime.ts",
];

const FORBIDDEN_BOUNDARY_PATTERNS = [
	{
		label: "classifies recovery by JavaScript error message",
		pattern: /(?:error|err)\.message\.(?:includes|match|startsWith|endsWith)\s*\(/,
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

export function findRuntimeFailureContractViolations(files, { requireBaseline = true } = {}) {
	const violations = [];
	const filesByPath = new Map(files.map((file) => [normalizePath(file.path), file.text]));

	if (requireBaseline) {
		for (const [path, markers] of Object.entries(REQUIRED_RUNTIME_FAILURE_MARKERS)) {
			const text = filesByPath.get(path);
			if (text === undefined) {
				violations.push(`${path}: required runtime failure contract file is missing`);
				continue;
			}
			for (const marker of markers) {
				if (!text.includes(marker)) violations.push(`${path}: missing contract marker (${marker})`);
			}
		}
	}

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
