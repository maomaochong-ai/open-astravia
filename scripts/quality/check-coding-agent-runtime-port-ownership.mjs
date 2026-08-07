/** Keep stable Coding Agent Runtime Ports single-owned and Adapter implementations conformant. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const RUNTIME_ADAPTER_ROOT = "packages/coding-agent/src/adapters/runtime-core";
const RUNTIME_IMPLEMENTATION_ROOTS = [
	RUNTIME_ADAPTER_ROOT,
	"packages/coding-agent/src/extensions/runtime",
	"packages/coding-agent/src/plugins/runtime",
	"packages/coding-agent/src/work-state",
];
const STABLE_CONSUMER_ROOTS = ["packages/coding-agent/src/composition", "packages/coding-agent/src/public-api"];

export const STABLE_RUNTIME_PORT_NAMES = Object.freeze([
	"CodingAgentCompactionExtensionRuntime",
	"CodingAgentExtensionEventBinding",
	"CodingAgentExtensionRunnerPort",
	"CodingAgentExtensionToolSource",
	"CodingAgentSessionToolRegistration",
	"CodingAgentModelCallPromptContext",
	"CodingAgentPluginMcpRuntime",
	"CodingAgentPluginRuntimeSource",
	"CodingAgentPromptResourceExpansion",
	"CodingAgentPromptResourceResolver",
	"CodingAgentPromptResourceSource",
	"CodingAgentPromptSettingsSource",
	"CodingAgentRuntimeModelSource",
	"CodingAgentRuntimeToolRegistration",
	"CodingAgentSystemPromptOptionsResolver",
	"CodingAgentTodoRuntime",
]);

const REQUIRED_IMPLEMENTATIONS = Object.freeze([
	{
		path: "packages/coding-agent/src/plugins/runtime/mcp-runtime.ts",
		name: "CodingAgentPluginMcpRuntime",
		pattern: /export\s+class\s+CodingAgentPluginMcpRuntime\s+implements\s+CodingAgentPluginMcpRuntimePort\b/,
	},
	{
		path: `${RUNTIME_ADAPTER_ROOT}/greenfield-todo-runtime.ts`,
		name: "CodingAgentTodoRuntime",
		pattern: /export\s+class\s+CodingAgentTodoRuntime\s+implements\s+CodingAgentTodoRuntimePort\b/,
	},
]);

export function collectCodingAgentRuntimePortOwnershipState(files) {
	const duplicateDeclarations = files
		.filter((file) => RUNTIME_IMPLEMENTATION_ROOTS.some((root) => file.path.startsWith(`${root}/`)))
		.flatMap((file) =>
			STABLE_RUNTIME_PORT_NAMES.filter((name) =>
				new RegExp(`export\\s+(?:interface|type)\\s+${name}\\b`).test(file.text),
			).map((name) => ({ path: file.path, name })),
		);
	const adapterPortImports = files
		.filter((file) => STABLE_CONSUMER_ROOTS.some((root) => file.path.startsWith(`${root}/`)))
		.flatMap((file) =>
			collectNamedImports(file.text)
				.filter(({ specifier }) => specifier.includes("/adapters/"))
				.flatMap(({ bindings, specifier }) =>
					bindings
						.filter(({ name, typeOnly }) => typeOnly && STABLE_RUNTIME_PORT_NAMES.includes(name))
						.map(({ name }) => ({ path: file.path, name, specifier })),
				),
		);
	const missingImplementations = REQUIRED_IMPLEMENTATIONS.filter((requirement) => {
		const implementation = files.find((file) => file.path === requirement.path)?.text ?? "";
		return !requirement.pattern.test(implementation);
	});
	return Object.freeze({ duplicateDeclarations, adapterPortImports, missingImplementations });
}

export function findCodingAgentRuntimePortOwnershipViolations(state) {
	return [
		...state.duplicateDeclarations.map(
			({ path, name }) => `${path}: Adapter redeclares stable Runtime Port (${name})`,
		),
		...state.adapterPortImports.map(
			({ path, name, specifier }) =>
				`${path}: stable Runtime Port is imported from Adapter (${name} from ${specifier})`,
		),
		...state.missingImplementations.map(
			({ path, name }) => `${path}: Adapter does not explicitly implement stable Runtime Port (${name})`,
		),
	];
}

function collectNamedImports(text) {
	const imports = [];
	const pattern = /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']+)["']/g;
	for (const match of text.matchAll(pattern)) {
		const declarationTypeOnly = match[1] !== undefined;
		const bindings = match[2]
			.split(",")
			.map((entry) => ({
				name: entry
					.replace(/^\s*type\s+/, "")
					.trim()
					.split(/\s+as\s+/)[0],
				typeOnly: declarationTypeOnly || /^\s*type\s+/.test(entry),
			}))
			.filter(({ name }) => name.length > 0);
		imports.push({ bindings, specifier: match[3] });
	}
	return imports;
}

function readCurrentFiles() {
	const directories = [...RUNTIME_IMPLEMENTATION_ROOTS, ...STABLE_CONSUMER_ROOTS];
	const files = directories.flatMap((directory) =>
		walkFiles(join(repoRoot, directory), { extensions: [".ts"] }).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
	);
	return [...new Map(files.map((file) => [file.path, file])).values()];
}

if (isDirectRun(import.meta.url)) {
	const state = collectCodingAgentRuntimePortOwnershipState(readCurrentFiles());
	const violations = findCodingAgentRuntimePortOwnershipViolations(state);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[coding-agent-runtime-port-ownership] ${violation}`);
	} else {
		ok(
			`[coding-agent-runtime-port-ownership] ok (duplicate declarations=${state.duplicateDeclarations.length}/0, Adapter Port imports=${state.adapterPortImports.length}/0, implementation conformance=${REQUIRED_IMPLEMENTATIONS.length - state.missingImplementations.length}/${REQUIRED_IMPLEMENTATIONS.length})`,
		);
	}
}
