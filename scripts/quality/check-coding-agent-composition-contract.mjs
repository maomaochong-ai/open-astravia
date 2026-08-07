/** Keep the public Coding Agent Composition contract split by responsibility and adapter-independent. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const COMPOSITION_CONTRACT_ROOT = "packages/coding-agent/src/composition/contracts";
const RUNTIME_CONTRACT_ROOT = "packages/coding-agent/src/runtime-contracts";
const COMPOSITION_OPTIONS_PATH = "packages/coding-agent/src/composition/contracts/runtime-composition-options.ts";
const MAX_CONTRACT_MODULE_LINES = 180;

export const REQUIRED_COMPOSITION_OPTION_FACETS = Object.freeze([
	"CodingAgentRuntimeEnvironmentOptions",
	"CodingAgentRuntimeConversationOptions",
	"CodingAgentRuntimeModelOptions",
	"CodingAgentRuntimeToolOptions",
	"CodingAgentRuntimeSubagentOptions",
	"CodingAgentRuntimePromptOptions",
	"CodingAgentRuntimePluginOptions",
	"CodingAgentRuntimeExtensionOptions",
	"CodingAgentRuntimeContextOptions",
	"CodingAgentRuntimeObservabilityOptions",
]);

export function collectCodingAgentCompositionContractState(files) {
	const contractFiles = files.filter((file) => isContractFile(file.path));
	const adapterDependencies = contractFiles.flatMap((file) =>
		collectModuleSpecifiers(file.text)
			.filter((specifier) => specifier.includes("/adapters/"))
			.map((specifier) => ({ path: file.path, specifier })),
	);
	const oversizedModules = contractFiles
		.map((file) => ({ path: file.path, lines: countLines(file.text), limit: MAX_CONTRACT_MODULE_LINES }))
		.filter((file) => file.lines > file.limit);
	const compositionOptions = files.find((file) => file.path === COMPOSITION_OPTIONS_PATH)?.text ?? "";
	const optionHeritage = collectInterfaceHeritage(compositionOptions, "CodingAgentRuntimeCompositionOptions");
	const composedFacets = REQUIRED_COMPOSITION_OPTION_FACETS.filter((facet) =>
		new RegExp(`\\b${facet}\\b`).test(optionHeritage),
	);
	return Object.freeze({
		contractFiles: contractFiles.map((file) => file.path).sort(),
		adapterDependencies,
		oversizedModules,
		composedFacets,
	});
}

export function findCodingAgentCompositionContractViolations(state) {
	const violations = [];
	for (const dependency of state.adapterDependencies) {
		violations.push(`${dependency.path}: public Composition contract depends on Adapter (${dependency.specifier})`);
	}
	for (const module of state.oversizedModules) {
		violations.push(`${module.path}: Composition contract module has ${module.lines} lines (limit ${module.limit})`);
	}
	for (const facet of REQUIRED_COMPOSITION_OPTION_FACETS) {
		if (!state.composedFacets.includes(facet)) {
			violations.push(`${COMPOSITION_OPTIONS_PATH}: missing Composition option facet (${facet})`);
		}
	}
	return violations;
}

function isContractFile(path) {
	return path.startsWith(`${COMPOSITION_CONTRACT_ROOT}/`) || path.startsWith(`${RUNTIME_CONTRACT_ROOT}/`);
}

function countLines(text) {
	return text.length === 0 ? 0 : text.replaceAll("\r\n", "\n").split("\n").length;
}

function collectModuleSpecifiers(text) {
	const specifiers = [];
	const pattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
	for (const match of text.matchAll(pattern)) specifiers.push(match[1]);
	return specifiers;
}

function collectInterfaceHeritage(text, interfaceName) {
	const pattern = new RegExp(`export\\s+interface\\s+${interfaceName}\\s+extends\\s+([^{]+)\\{`);
	return pattern.exec(text)?.[1] ?? "";
}

function readCurrentFiles() {
	const directories = [COMPOSITION_CONTRACT_ROOT, RUNTIME_CONTRACT_ROOT];
	return directories.flatMap((directory) =>
		walkFiles(join(repoRoot, directory), { extensions: [".ts"] }).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
	);
}

if (isDirectRun(import.meta.url)) {
	const state = collectCodingAgentCompositionContractState(readCurrentFiles());
	const violations = findCodingAgentCompositionContractViolations(state);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[coding-agent-composition-contract] ${violation}`);
	} else {
		ok(
			`[coding-agent-composition-contract] ok (contract modules=${state.contractFiles.length}, option facets=${state.composedFacets.length}/${REQUIRED_COMPOSITION_OPTION_FACETS.length}, Adapter dependencies=${state.adapterDependencies.length}/0)`,
		);
	}
}
