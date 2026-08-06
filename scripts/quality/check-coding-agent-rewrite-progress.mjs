/**
 * Track the complete Coding Agent rewrite independently from Legacy execution retirement.
 * Existing old-implementation edges are an exact baseline: every change must update the
 * baseline deliberately, and the final target for every reported category is zero.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { RETAINED_LEGACY_FORMAT_BOUNDARIES } from "./check-legacy-execution-retirement.mjs";
import { fail, isDirectRun, ok, readText, rel, repoRoot, toPosix, walkFiles } from "./lib.mjs";

export const REWRITE_BASELINE_PATH = "scripts/quality/baselines/coding-agent-rewrite.json";

const OLD_CORE_PREFIX = "packages/coding-agent/src/core/";
const RETIRED_RUNTIME_COMPOSITION_PREFIX = "packages/runtime-composition/";
const RETIRED_RUNTIME_COMPOSITION_MARKER = "@vetta/runtime-composition";
const RETIRED_CLI_COMPOSITION_FORWARDERS = Object.freeze([
	"packages/cli-app/src/conversation-ownership-binding.ts",
	"packages/cli-app/src/greenfield-runtime-composition.ts",
	"packages/cli-app/src/greenfield-runtime-host-session-backend.ts",
	"packages/cli-app/src/greenfield-session-execution-runtime.ts",
	"packages/cli-app/src/greenfield-session-peripherals.ts",
	"packages/cli-app/src/greenfield-subagent-child.ts",
	"packages/cli-app/src/greenfield-subagent-runtime.ts",
	"packages/cli-app/src/greenfield-subagent-state-persistence.ts",
	"packages/cli-app/src/rpc/greenfield-conversation-path.ts",
	"packages/cli-app/src/runtime-tools-composition.ts",
]);
const RETIRED_CLI_SESSION_HOST_FILES = Object.freeze([
	"packages/cli-app/src/agent-runtime/greenfield-agent-session-host.ts",
	"packages/cli-app/src/agent-runtime/greenfield-extension-session-host.ts",
	"packages/cli-app/src/rpc/greenfield-im-extension-session-host.ts",
]);
const RETIRED_CLI_SESSION_HOST_MARKERS = Object.freeze([
	"GreenfieldAgentSessionHost",
	"GreenfieldExtensionSessionHost",
	"GreenfieldImExtensionSessionHost",
	"GreenfieldCliSessionOptions",
]);
const CODING_AGENT_SESSION_HOST_PREFIX = "packages/coding-agent/src/composition/session-host/";
const CLI_SESSION_PROTOCOL_MARKERS = Object.freeze([
	"@vetta/cli-app",
	"GreenfieldImRpcSessionAdapter",
	"GreenfieldPrintSessionAdapter",
	"GreenfieldRpcSessionAdapter",
	"RpcSessionCapabilities",
]);
const RETIRED_CLI_RUNTIME_HOST_FILES = Object.freeze([
	"packages/cli-app/src/rpc/greenfield-im-runtime-host.ts",
	"packages/cli-app/src/rpc/greenfield-rpc-runtime-host.ts",
]);
const RETIRED_CLI_RUNTIME_HOST_MARKERS = Object.freeze([
	"GreenfieldImFallbackReason",
	"GreenfieldImRuntimeHostExtensionIncompatible",
	"GreenfieldImRuntimeHostFallback",
	"GreenfieldImRuntimeHostPreparation",
	"GreenfieldImRuntimeHostReady",
	"PrepareGreenfieldImRuntimeHostOptions",
	"PrepareGreenfieldRpcRuntimeHostOptions",
]);
const CLI_RUNTIME_HOST_ENTRY = "packages/cli-app/src/rpc/runtime-host/greenfield-runtime-host.ts";
const CLI_RUNTIME_HOST_ENTRY_OWNERSHIP_MARKERS = Object.freeze([
	"class GreenfieldRpcRuntimeHostCapabilities",
	"createCodingAgentMcpRuntimeToolSource",
	"new CodingAgentProcessSessionHost",
	"new GreenfieldImRpcSessionAdapter",
	"new GreenfieldRpcSessionAdapter",
]);
const CLI_SESSION_ASSEMBLY = "packages/cli-app/src/rpc/runtime-host/greenfield-cli-session-assembly.ts";
const CLI_SESSION_ASSEMBLY_PROTOCOL_MARKERS = Object.freeze([
	"GreenfieldImRpcSessionAdapter",
	"GreenfieldPrintSessionAdapter",
	"GreenfieldRpcSessionAdapter",
	"RpcSessionCapabilities",
	"runRpcModeWithCapabilities",
]);
const CODING_AGENT_COMPOSITION_PUBLIC_ENTRY = "packages/coding-agent/src/composition/index.ts";
const CODING_AGENT_COMPOSITION_PUBLIC_EXPORTS = new Set([
	"CodingAgentExtensionSessionHost",
	"CodingAgentActiveSessionHost",
	"CodingAgentProcessSessionHost",
	"CodingAgentRuntimeComposition",
	"CodingAgentRuntimeCompositionOptions",
	"CodingAgentRuntimeHostSessionBackend",
	"CodingAgentRuntimeSessionOptions",
	"CodingAgentSessionTransition",
	"CodingAgentSessionTransitionLifecycle",
	"CodingAgentSessionSetup",
	"KnowledgeProcessingPageWriter",
	"KnowledgeProcessingSession",
	"KnowledgeProcessingSessionFactory",
	"KnowledgeProcessingSessionRequest",
	"KnowledgeProcessingUsage",
	"createCodingAgentSessionSetupSeedInitializer",
	"createCodingAgentRuntimeComposition",
	"createKnowledgeProcessingSessionFactory",
	"resolveSessionIdFromPath",
]);
const CODING_AGENT_COMPOSITION_DEEP_IMPORT_MARKER = "@vetta/coding-agent/composition/";
const CODING_AGENT_ROOT_ENTRY = "packages/coding-agent/src/index.ts";
const CODING_AGENT_ROOT_EXTENSION_ENTRY = "./public-api/extensions.js";
const CLI_COMPOSITION_TYPE_NAMES = new Set([
	"CodingAgentActiveSessionHost",
	"CodingToolsRuntimeComposition",
	"CodingAgentRuntimeComposition",
	"CodingAgentRuntimeCompositionOptions",
	"CodingAgentRuntimeHostSessionBackend",
	"resolveSessionIdFromPath",
]);
const STABLE_EXTENSION_CONTRACT_PREFIX = "packages/coding-agent/src/extensions/";
const STABLE_RESOURCE_DOMAIN_PREFIX = "packages/coding-agent/src/resources/";
const STABLE_CONTEXT_RUNTIME_PREFIX = "packages/coding-agent/src/adapters/runtime-core/context-runtime/";
const STABLE_EXTENSION_CONTRACT_AGGREGATE = `${STABLE_EXTENSION_CONTRACT_PREFIX}contracts.ts`;
const MAX_EXTENSION_AGGREGATE_LINES = 50;
const MAX_EXTENSION_MODULE_LINES = 300;
const STABLE_RESOURCE_AGGREGATE = `${STABLE_RESOURCE_DOMAIN_PREFIX}index.ts`;
const MAX_RESOURCE_AGGREGATE_LINES = 50;
const MAX_RESOURCE_MODULE_LINES = 600;
const STABLE_CONTEXT_RUNTIME_AGGREGATE = `${STABLE_CONTEXT_RUNTIME_PREFIX}index.ts`;
const MAX_CONTEXT_RUNTIME_AGGREGATE_LINES = 50;
const MAX_CONTEXT_RUNTIME_MODULE_LINES = 400;
const FORBIDDEN_LEGACY_HTML_EXPORT_MARKERS = Object.freeze([
	"core/export-html",
	"installExportTemplateAssets",
	"@vetta/coding-agent/export-template-assets",
]);
const FORBIDDEN_LEGACY_MEMORY_MARKERS = Object.freeze([
	"core/memory/",
	"core/tools/memory/",
	"greenfield-memory-rollover-orchestrator",
]);
const FORBIDDEN_RETIRED_TOOL_MARKERS = Object.freeze([
	"core/tools/",
	"core/background-tasks/",
	"core/session/tool-scope",
	"core/todo-store",
	"generate-tool-descriptions",
	"generate:descriptions",
]);
const RUNTIME_PACKAGE_PREFIXES = Object.freeze([
	"packages/runtime-core/src/",
	"packages/runtime-tools/src/",
	"packages/runtime-storage/src/",
	"packages/runtime-mcp/src/",
]);
const OLD_IMPLEMENTATION_EXACT_FILES = Object.freeze([
	"packages/coding-agent/src/adapters/runtime-core/greenfield-context-runtime.ts",
	"packages/coding-agent/src/adapters/runtime-core/greenfield-model-registry-adapter.ts",
	"packages/coding-agent/src/adapters/runtime-core/model-registry-shared-model-controller.ts",
	"packages/coding-agent/src/composition/greenfield-active-session-transition-host.ts",
	"packages/coding-agent/src/modes/rpc/legacy-rpc-session-adapter.ts",
	"packages/coding-agent/src/public-api/compat-runtime-storage.ts",
	"packages/coding-agent/src/public-api/compat-runtime-tools.ts",
	"packages/coding-agent/src/public-api/model-registry-compat.ts",
	"packages/coding-agent/src/public-api/sdk-compatibility-inventory.ts",
]);

export function collectCodingAgentRewriteState({
	productionFiles,
	sdkExampleFiles,
	codingAgentPackageJson,
	governedFiles = productionFiles,
}) {
	const moduleEdges = productionFiles.flatMap((file) => collectModuleEdges(file.path, file.text));
	const oldImplementationEdges = moduleEdges
		.filter((edge) => !isOldImplementationFile(edge.path))
		.flatMap((edge) => classifyOldImplementationEdge(edge))
		.sort(compareRecords);
	const runtimeBackedges = moduleEdges
		.filter(
			(edge) =>
				RUNTIME_PACKAGE_PREFIXES.some((prefix) => edge.path.startsWith(prefix)) &&
				edge.specifier.startsWith("@vetta/coding-agent"),
		)
		.map(toBaselineEdge)
		.sort(compareRecords);
	const oldImplementationFiles = productionFiles
		.map((file) => file.path)
		.filter(isOldImplementationFile)
		.sort();
	const compatibilityExports = Object.keys(codingAgentPackageJson.exports ?? {})
		.filter((exportName) => exportName.startsWith("./compat/"))
		.sort();
	const legacyCoreExports = Object.keys(codingAgentPackageJson.exports ?? {})
		.filter((exportName) => exportName.startsWith("./core/"))
		.sort();
	const runtimeHostExports = Object.keys(codingAgentPackageJson.exports ?? {})
		.filter((exportName) => exportName === "./runtime-host" || exportName.startsWith("./runtime-host/"))
		.sort();
	const legacyExampleImports = sdkExampleFiles
		.flatMap((file) => collectModuleEdges(file.path, file.text))
		.filter(
			(edge) => edge.specifier === "@vetta/coding-agent" || edge.specifier.startsWith("@vetta/coding-agent/compat/"),
		)
		.map(toBaselineEdge)
		.sort(compareRecords);
	const oversizedStableExtensionModules = productionFiles
		.filter((file) => file.path.startsWith(STABLE_EXTENSION_CONTRACT_PREFIX) && file.path.endsWith(".ts"))
		.map((file) => ({
			path: file.path,
			lines: file.text.split(/\r?\n/).length,
			limit:
				file.path === STABLE_EXTENSION_CONTRACT_AGGREGATE
					? MAX_EXTENSION_AGGREGATE_LINES
					: MAX_EXTENSION_MODULE_LINES,
		}))
		.filter((file) => file.lines > file.limit)
		.sort((left, right) => left.path.localeCompare(right.path));
	const oversizedStableResourceModules = productionFiles
		.filter((file) => file.path.startsWith(STABLE_RESOURCE_DOMAIN_PREFIX) && file.path.endsWith(".ts"))
		.map((file) => ({
			path: file.path,
			lines: file.text.split(/\r?\n/).length,
			limit: file.path === STABLE_RESOURCE_AGGREGATE ? MAX_RESOURCE_AGGREGATE_LINES : MAX_RESOURCE_MODULE_LINES,
		}))
		.filter((file) => file.lines > file.limit)
		.sort((left, right) => left.path.localeCompare(right.path));
	const oversizedContextRuntimeModules = productionFiles
		.filter((file) => file.path.startsWith(STABLE_CONTEXT_RUNTIME_PREFIX) && file.path.endsWith(".ts"))
		.map((file) => ({
			path: file.path,
			lines: file.text.split(/\r?\n/).length,
			limit:
				file.path === STABLE_CONTEXT_RUNTIME_AGGREGATE
					? MAX_CONTEXT_RUNTIME_AGGREGATE_LINES
					: MAX_CONTEXT_RUNTIME_MODULE_LINES,
		}))
		.filter((file) => file.lines > file.limit)
		.sort((left, right) => left.path.localeCompare(right.path));
	const legacyHtmlExportReferences = governedFiles
		.flatMap((file) => collectForbiddenHtmlExportReferences(file))
		.sort(
			(left, right) =>
				left.path.localeCompare(right.path) || left.line - right.line || left.marker.localeCompare(right.marker),
		);
	const legacyMemoryReferences = governedFiles
		.flatMap((file) => collectForbiddenReferences(file, FORBIDDEN_LEGACY_MEMORY_MARKERS))
		.sort(
			(left, right) =>
				left.path.localeCompare(right.path) || left.line - right.line || left.marker.localeCompare(right.marker),
		);
	const retiredToolReferences = governedFiles
		.flatMap((file) => collectForbiddenReferences(file, FORBIDDEN_RETIRED_TOOL_MARKERS))
		.sort(
			(left, right) =>
				left.path.localeCompare(right.path) || left.line - right.line || left.marker.localeCompare(right.marker),
		);
	const retiredRuntimeCompositionFiles = governedFiles
		.map((file) => file.path)
		.filter((path) => path.startsWith(RETIRED_RUNTIME_COMPOSITION_PREFIX))
		.sort();
	const retiredRuntimeCompositionReferences = governedFiles
		.flatMap((file) => collectForbiddenReferences(file, [RETIRED_RUNTIME_COMPOSITION_MARKER]))
		.sort(
			(left, right) =>
				left.path.localeCompare(right.path) || left.line - right.line || left.marker.localeCompare(right.marker),
		);
	const cliCompositionForwarders = productionFiles
		.map((file) => file.path)
		.filter((path) => RETIRED_CLI_COMPOSITION_FORWARDERS.includes(path))
		.sort();
	const cliCompositionPublicEdges = moduleEdges
		.filter(
			(edge) =>
				edge.path === "packages/cli-app/src/index.ts" && edge.specifier === "@vetta/coding-agent/composition",
		)
		.map(toBaselineEdge)
		.sort(compareRecords);
	const desktopCliCompositionEdges = moduleEdges
		.filter(
			(edge) =>
				edge.path.startsWith("packages/desktop-app/src/") &&
				edge.specifier === "@vetta/cli-app" &&
				edge.names.some((name) => CLI_COMPOSITION_TYPE_NAMES.has(name)),
		)
		.map(toBaselineEdge)
		.sort(compareRecords);
	const retiredCliSessionHostFiles = productionFiles
		.map((file) => file.path)
		.filter((path) => RETIRED_CLI_SESSION_HOST_FILES.includes(path))
		.sort();
	const retiredCliSessionHostReferences = governedFiles
		.flatMap((file) => collectForbiddenReferences(file, RETIRED_CLI_SESSION_HOST_MARKERS))
		.sort(compareReferences);
	const codingAgentSessionHostProtocolReferences = productionFiles
		.filter((file) => file.path.startsWith(CODING_AGENT_SESSION_HOST_PREFIX))
		.flatMap((file) => collectForbiddenReferences(file, CLI_SESSION_PROTOCOL_MARKERS))
		.sort(compareReferences);
	const retiredCliRuntimeHostFiles = productionFiles
		.map((file) => file.path)
		.filter((path) => RETIRED_CLI_RUNTIME_HOST_FILES.includes(path))
		.sort();
	const retiredCliRuntimeHostReferences = governedFiles
		.flatMap((file) => collectForbiddenReferences(file, RETIRED_CLI_RUNTIME_HOST_MARKERS))
		.sort(compareReferences);
	const runtimeHostEntryOwnershipReferences = productionFiles
		.filter((file) => file.path === CLI_RUNTIME_HOST_ENTRY)
		.flatMap((file) => collectForbiddenReferences(file, CLI_RUNTIME_HOST_ENTRY_OWNERSHIP_MARKERS))
		.sort(compareReferences);
	const cliSessionAssemblyProtocolReferences = productionFiles
		.filter((file) => file.path === CLI_SESSION_ASSEMBLY)
		.flatMap((file) => collectForbiddenReferences(file, CLI_SESSION_ASSEMBLY_PROTOCOL_MARKERS))
		.sort(compareReferences);
	const compositionPublicExports = moduleEdges
		.filter((edge) => edge.path === CODING_AGENT_COMPOSITION_PUBLIC_ENTRY)
		.flatMap((edge) => edge.names)
		.sort();
	const externalCompositionDeepImports = governedFiles
		.filter((file) => !file.path.startsWith("packages/coding-agent/"))
		.flatMap((file) => collectForbiddenReferences(file, [CODING_AGENT_COMPOSITION_DEEP_IMPORT_MARKER]))
		.sort(compareReferences);
	const codingAgentRootExportEdges = moduleEdges
		.filter((edge) => edge.path === CODING_AGENT_ROOT_ENTRY)
		.map(toBaselineEdge)
		.sort(compareRecords);
	const codingAgentRootDisallowedExportEdges = codingAgentRootExportEdges.filter(
		(edge) =>
			edge.specifier !== CODING_AGENT_ROOT_EXTENSION_ENTRY || edge.names.length !== 1 || edge.names[0] !== "*",
	);

	return Object.freeze({
		version: 12,
		oldImplementationEdges,
		runtimeBackedges,
		oldImplementationFiles,
		compatibilityExports,
		legacyCoreExports,
		runtimeHostExports,
		legacyExampleImports,
		oversizedStableExtensionModules,
		oversizedStableResourceModules,
		oversizedContextRuntimeModules,
		legacyHtmlExportReferences,
		legacyMemoryReferences,
		retiredToolReferences,
		retiredRuntimeCompositionFiles,
		retiredRuntimeCompositionReferences,
		cliCompositionForwarders,
		cliCompositionPublicEdges,
		desktopCliCompositionEdges,
		retiredCliSessionHostFiles,
		retiredCliSessionHostReferences,
		codingAgentSessionHostProtocolReferences,
		retiredCliRuntimeHostFiles,
		retiredCliRuntimeHostReferences,
		runtimeHostEntryOwnershipReferences,
		cliSessionAssemblyProtocolReferences,
		compositionPublicExports,
		externalCompositionDeepImports,
		codingAgentRootExportEdges,
		codingAgentRootDisallowedExportEdges,
	});
}

export function findCodingAgentRewriteProgressViolations(actual, baseline) {
	const violations = [];
	for (const edge of actual.oldImplementationEdges) {
		if (edge.path.startsWith(STABLE_EXTENSION_CONTRACT_PREFIX)) {
			violations.push(`${edge.path}: stable Extension contract depends on old implementation (${edge.specifier})`);
		}
		if (edge.path.startsWith(STABLE_RESOURCE_DOMAIN_PREFIX)) {
			violations.push(`${edge.path}: stable Resource domain depends on old implementation (${edge.specifier})`);
		}
	}
	for (const file of actual.oversizedStableExtensionModules) {
		violations.push(`${file.path}: stable Extension module has ${file.lines} lines (limit ${file.limit})`);
	}
	for (const file of actual.oversizedStableResourceModules) {
		violations.push(`${file.path}: stable Resource module has ${file.lines} lines (limit ${file.limit})`);
	}
	for (const file of actual.oversizedContextRuntimeModules) {
		violations.push(`${file.path}: Context Runtime module has ${file.lines} lines (limit ${file.limit})`);
	}
	for (const reference of actual.legacyHtmlExportReferences) {
		violations.push(
			`${reference.path}:${reference.line}: forbidden Legacy HTML export reference (${reference.marker})`,
		);
	}
	for (const reference of actual.legacyMemoryReferences) {
		violations.push(`${reference.path}:${reference.line}: forbidden Legacy Memory reference (${reference.marker})`);
	}
	for (const reference of actual.retiredToolReferences) {
		violations.push(
			`${reference.path}:${reference.line}: retired Tool implementation reference (${reference.marker})`,
		);
	}
	for (const path of actual.retiredRuntimeCompositionFiles) {
		violations.push(`${path}: retired runtime-composition package file must stay deleted`);
	}
	for (const reference of actual.retiredRuntimeCompositionReferences) {
		violations.push(
			`${reference.path}:${reference.line}: retired runtime-composition reference (${reference.marker})`,
		);
	}
	for (const path of actual.cliCompositionForwarders) {
		violations.push(`${path}: retired CLI composition forwarding module must stay deleted`);
	}
	for (const edge of actual.cliCompositionPublicEdges) {
		violations.push(`${edge.path}: CLI public API must not re-export Coding Agent composition`);
	}
	for (const edge of actual.desktopCliCompositionEdges) {
		violations.push(`${edge.path}: Desktop must import Coding Agent composition contracts from their owner`);
	}
	for (const path of actual.retiredCliSessionHostFiles) {
		violations.push(`${path}: retired CLI Session Host file must stay deleted`);
	}
	for (const reference of actual.retiredCliSessionHostReferences) {
		violations.push(`${reference.path}:${reference.line}: retired CLI Session Host reference (${reference.marker})`);
	}
	for (const reference of actual.codingAgentSessionHostProtocolReferences) {
		violations.push(
			`${reference.path}:${reference.line}: Coding Agent Session Host depends on CLI protocol (${reference.marker})`,
		);
	}
	for (const path of actual.retiredCliRuntimeHostFiles) {
		violations.push(`${path}: retired CLI Runtime Host file must stay deleted`);
	}
	for (const reference of actual.retiredCliRuntimeHostReferences) {
		violations.push(`${reference.path}:${reference.line}: retired CLI Runtime Host reference (${reference.marker})`);
	}
	for (const reference of actual.runtimeHostEntryOwnershipReferences) {
		violations.push(
			`${reference.path}:${reference.line}: CLI Runtime Host entry owns extracted runtime resources (${reference.marker})`,
		);
	}
	for (const reference of actual.cliSessionAssemblyProtocolReferences) {
		violations.push(
			`${reference.path}:${reference.line}: CLI Session assembly depends on protocol capabilities (${reference.marker})`,
		);
	}
	for (const exportName of actual.compositionPublicExports) {
		if (!CODING_AGENT_COMPOSITION_PUBLIC_EXPORTS.has(exportName)) {
			violations.push(
				`${CODING_AGENT_COMPOSITION_PUBLIC_ENTRY}: unapproved Composition public export (${exportName})`,
			);
		}
	}
	for (const reference of actual.externalCompositionDeepImports) {
		violations.push(
			`${reference.path}:${reference.line}: external consumer deep-imports Coding Agent Composition (${reference.marker})`,
		);
	}
	for (const edge of actual.codingAgentRootDisallowedExportEdges) {
		violations.push(`${edge.path}: package root may only export the stable Extension facade (${edge.specifier})`);
	}
	if (baseline.version !== actual.version) {
		violations.push(`rewrite baseline version differs (${baseline.version} !== ${actual.version})`);
	}
	compareBaselineRecords(
		"old implementation dependency",
		actual.oldImplementationEdges,
		baseline.oldImplementationEdges,
		violations,
	);
	compareBaselineRecords("Runtime package backedge", actual.runtimeBackedges, baseline.runtimeBackedges, violations);
	compareBaselineValues(
		"old implementation file",
		actual.oldImplementationFiles,
		baseline.oldImplementationFiles,
		violations,
	);
	compareBaselineValues(
		"compatibility package export",
		actual.compatibilityExports,
		baseline.compatibilityExports,
		violations,
	);
	compareBaselineValues(
		"legacy core package export",
		actual.legacyCoreExports,
		baseline.legacyCoreExports,
		violations,
	);
	compareBaselineValues(
		"retired Runtime Host package export",
		actual.runtimeHostExports,
		baseline.runtimeHostExports,
		violations,
	);
	compareBaselineRecords(
		"legacy SDK example import",
		actual.legacyExampleImports,
		baseline.legacyExampleImports,
		violations,
	);
	compareBaselineValues(
		"Composition public export",
		actual.compositionPublicExports,
		baseline.compositionPublicExports,
		violations,
	);
	compareBaselineRecords(
		"package-root export",
		actual.codingAgentRootExportEdges,
		baseline.codingAgentRootExportEdges,
		violations,
	);
	if (actual.codingAgentRootExportEdges.length !== baseline.codingAgentRootExportEdges.length) {
		violations.push(
			`${CODING_AGENT_ROOT_ENTRY}: package-root export count differs (${actual.codingAgentRootExportEdges.length} !== ${baseline.codingAgentRootExportEdges.length})`,
		);
	}
	return violations;
}

export function summarizeCodingAgentRewriteState(state) {
	const domains = new Map();
	for (const edge of state.oldImplementationEdges) {
		domains.set(edge.domain, (domains.get(edge.domain) ?? 0) + 1);
	}
	const formatBoundarySet = new Set(RETAINED_LEGACY_FORMAT_BOUNDARIES);
	return Object.freeze({
		oldImplementationEdges: state.oldImplementationEdges.length,
		runtimeBackedges: state.runtimeBackedges.length,
		oldImplementationFiles: state.oldImplementationFiles.length,
		compatibilityExports: state.compatibilityExports.length,
		legacyCoreExports: state.legacyCoreExports.length,
		runtimeHostExports: state.runtimeHostExports.length,
		legacyExampleImports: state.legacyExampleImports.length,
		oversizedContextRuntimeModules: state.oversizedContextRuntimeModules.length,
		legacyHtmlExportReferences: state.legacyHtmlExportReferences.length,
		legacyMemoryReferences: state.legacyMemoryReferences.length,
		retiredToolReferences: state.retiredToolReferences.length,
		retiredRuntimeCompositionFiles: state.retiredRuntimeCompositionFiles.length,
		retiredRuntimeCompositionReferences: state.retiredRuntimeCompositionReferences.length,
		cliCompositionForwarders: state.cliCompositionForwarders.length,
		cliCompositionPublicEdges: state.cliCompositionPublicEdges.length,
		desktopCliCompositionEdges: state.desktopCliCompositionEdges.length,
		retiredCliSessionHostFiles: state.retiredCliSessionHostFiles.length,
		retiredCliSessionHostReferences: state.retiredCliSessionHostReferences.length,
		codingAgentSessionHostProtocolReferences: state.codingAgentSessionHostProtocolReferences.length,
		retiredCliRuntimeHostFiles: state.retiredCliRuntimeHostFiles.length,
		retiredCliRuntimeHostReferences: state.retiredCliRuntimeHostReferences.length,
		runtimeHostEntryOwnershipReferences: state.runtimeHostEntryOwnershipReferences.length,
		cliSessionAssemblyProtocolReferences: state.cliSessionAssemblyProtocolReferences.length,
		compositionPublicExports: state.compositionPublicExports.length,
		externalCompositionDeepImports: state.externalCompositionDeepImports.length,
		codingAgentRootExportEdges: state.codingAgentRootExportEdges.length,
		codingAgentRootDisallowedExportEdges: state.codingAgentRootDisallowedExportEdges.length,
		retainedFormatBoundaries: RETAINED_LEGACY_FORMAT_BOUNDARIES.length,
		formatBoundaryOldImplementationEdges: state.oldImplementationEdges.filter((edge) =>
			formatBoundarySet.has(edge.path),
		).length,
		domains: Object.fromEntries(
			[...domains].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
		),
	});
}

function collectForbiddenHtmlExportReferences(file) {
	return collectForbiddenReferences(file, FORBIDDEN_LEGACY_HTML_EXPORT_MARKERS);
}

function collectForbiddenReferences(file, markers) {
	return file.text.split(/\r?\n/).flatMap((line, index) =>
		markers
			.filter((marker) => line.includes(marker))
			.map((marker) => ({
				path: file.path,
				line: index + 1,
				marker,
			})),
	);
}

function compareReferences(left, right) {
	return left.path.localeCompare(right.path) || left.line - right.line || left.marker.localeCompare(right.marker);
}

function classifyOldImplementationEdge(edge) {
	const resolvedTarget = resolveSourceTarget(edge.path, edge.specifier);
	if (resolvedTarget?.startsWith(OLD_CORE_PREFIX)) {
		return [{ ...toBaselineEdge(edge), category: "old-core", domain: readCoreDomain(resolvedTarget) }];
	}
	if (edge.specifier.startsWith("@vetta/coding-agent/core/")) {
		return [
			{
				...toBaselineEdge(edge),
				category: "old-core-public-subpath",
				domain: readCoreDomain(`packages/coding-agent/src/${edge.specifier.slice("@vetta/coding-agent/".length)}`),
			},
		];
	}
	if (
		edge.specifier.startsWith("@vetta/coding-agent/compat/") ||
		resolvedTarget?.startsWith("packages/coding-agent/src/public-api/compat-")
	) {
		return [{ ...toBaselineEdge(edge), category: "compatibility-entry", domain: "compatibility" }];
	}
	if (edge.specifier === "@vetta/coding-agent") {
		return [{ ...toBaselineEdge(edge), category: "legacy-package-root", domain: "public-api" }];
	}
	return [];
}

function collectModuleEdges(path, text) {
	if (!path.includes("/src/") && !path.includes("/examples/sdk/")) return [];
	if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) {
		return [];
	}
	const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
	const edges = [];
	const visit = (node) => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
			edges.push({ path, specifier: node.moduleSpecifier.text, names: collectImportNames(node.importClause) });
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
			edges.push({ path, specifier: node.moduleSpecifier.text, names: collectExportNames(node.exportClause) });
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1 &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			edges.push({ path, specifier: node.arguments[0].text, names: ["<dynamic>"] });
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return edges;
}

function collectImportNames(clause) {
	if (!clause) return ["<side-effect>"];
	const names = [];
	if (clause.name) names.push("default");
	if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
		for (const element of clause.namedBindings.elements) names.push(element.propertyName?.text ?? element.name.text);
	}
	if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push("*");
	return names.sort();
}

function collectExportNames(clause) {
	if (!clause || !ts.isNamedExports(clause)) return ["*"];
	return clause.elements.map((element) => element.name.text).sort();
}

function resolveSourceTarget(sourcePath, specifier) {
	if (!specifier.startsWith(".")) return undefined;
	return posix.normalize(posix.join(posix.dirname(sourcePath), specifier)).replace(/\.js$/, ".ts");
}

function readCoreDomain(target) {
	return target.slice(OLD_CORE_PREFIX.length).split("/")[0]?.replace(/\.ts$/, "") || "unknown";
}

function isOldImplementationFile(path) {
	return path.startsWith(OLD_CORE_PREFIX) || OLD_IMPLEMENTATION_EXACT_FILES.includes(path);
}

function toBaselineEdge(edge) {
	return Object.freeze({ path: edge.path, specifier: edge.specifier, names: [...edge.names].sort() });
}

function compareRecords(left, right) {
	return recordKey(left).localeCompare(recordKey(right));
}

function recordKey(record) {
	return `${record.path}\0${record.specifier}\0${record.names.join(",")}\0${record.category ?? ""}\0${record.domain ?? ""}`;
}

function compareBaselineRecords(label, actual, baseline, violations) {
	const actualKeys = new Map(actual.map((record) => [recordKey(record), record]));
	const baselineKeys = new Map(baseline.map((record) => [recordKey(record), record]));
	for (const [key, record] of actualKeys) {
		if (!baselineKeys.has(key)) violations.push(`${record.path}: new ${label} (${record.specifier})`);
	}
	for (const [key, record] of baselineKeys) {
		if (!actualKeys.has(key)) violations.push(`${record.path}: stale ${label} baseline (${record.specifier})`);
	}
}

function compareBaselineValues(label, actual, baseline, violations) {
	const actualSet = new Set(actual);
	const baselineSet = new Set(baseline);
	for (const value of actualSet) {
		if (!baselineSet.has(value)) violations.push(`${value}: new ${label}`);
	}
	for (const value of baselineSet) {
		if (!actualSet.has(value)) violations.push(`${value}: stale ${label} baseline`);
	}
}

function scriptKind(path) {
	if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function readProductionSources() {
	return walkFiles(join(repoRoot, "packages"))
		.map((filePath) => ({ path: rel(filePath), text: readText(filePath) }))
		.filter((file) => file.path.includes("/src/"));
}

function readSdkExamples() {
	return walkFiles(join(repoRoot, "packages/coding-agent/examples/sdk"))
		.map((filePath) => ({ path: rel(filePath), text: readText(filePath) }))
		.filter((file) => /\.[cm]?[jt]sx?$/.test(file.path));
}

function readCurrentState() {
	const codingAgentPackagePath = join(repoRoot, "packages/coding-agent/package.json");
	const codingAgentPackageText = readText(codingAgentPackagePath);
	const codingAgentPackageJson = JSON.parse(codingAgentPackageText);
	const productionFiles = readProductionSources();
	const sdkExampleFiles = readSdkExamples();
	const governedFiles = [
		...productionFiles,
		...sdkExampleFiles,
		...readSourceFiles("packages/coding-agent/test"),
		...readSourceFiles("packages/cli-app/test"),
		...readSourceFiles("packages/runtime-tools/test"),
		...walkFiles(join(repoRoot, "packages/cli-app/scripts")).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
		...walkFiles(join(repoRoot, "packages/coding-agent/scripts")).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
		{ path: rel(codingAgentPackagePath), text: codingAgentPackageText },
		...readGovernedConfigurationFiles(),
		{
			path: "scripts/build-binaries.sh",
			text: readText(join(repoRoot, "scripts/build-binaries.sh")),
		},
	];
	return collectCodingAgentRewriteState({
		productionFiles,
		sdkExampleFiles,
		codingAgentPackageJson,
		governedFiles,
	});
}

function readGovernedConfigurationFiles() {
	return [
		"package.json",
		"tsconfig.json",
		"scripts/build.sh",
		"packages/cli-app/package.json",
		"packages/cli-app/vitest.config.ts",
		"packages/desktop-app/package.json",
		"packages/desktop-app/tsconfig.json",
		"packages/desktop-app/vitest.config.ts",
		"packages/desktop-app/scripts/build-workspace-prereqs.mjs",
	].map((path) => ({ path, text: readText(join(repoRoot, path)) }));
}

function readSourceFiles(relativePath) {
	return walkFiles(join(repoRoot, relativePath))
		.map((filePath) => ({ path: rel(filePath), text: readText(filePath) }))
		.filter((file) => /\.[cm]?[jt]sx?$/.test(file.path));
}

if (isDirectRun(import.meta.url)) {
	const actual = readCurrentState();
	if (process.argv.includes("--write-baseline")) {
		const baselinePath = join(repoRoot, REWRITE_BASELINE_PATH);
		writeFileSync(baselinePath, `${JSON.stringify(actual, null, "\t")}\n`, "utf8");
		ok(`[coding-agent-rewrite] wrote baseline: ${toPosix(REWRITE_BASELINE_PATH)}`);
	} else if (process.argv.includes("--print-baseline")) {
		console.log(JSON.stringify(actual, null, "\t"));
	} else {
		const baselinePath = join(repoRoot, REWRITE_BASELINE_PATH);
		if (!existsSync(baselinePath)) {
			fail(`[coding-agent-rewrite] missing baseline: ${toPosix(REWRITE_BASELINE_PATH)}`);
		} else {
			const baseline = JSON.parse(readText(baselinePath));
			const violations = findCodingAgentRewriteProgressViolations(actual, baseline);
			if (violations.length > 0) {
				for (const violation of violations) fail(`[coding-agent-rewrite] ${violation}`);
			} else {
				const summary = summarizeCodingAgentRewriteState(actual);
				const domains = Object.entries(summary.domains)
					.map(([domain, count]) => `${domain}=${count}`)
					.join(", ");
				ok(
					`[coding-agent-rewrite] ok (old implementation edges=${summary.oldImplementationEdges}/0, Runtime backedges=${summary.runtimeBackedges}/0, old files=${summary.oldImplementationFiles}/0, compatibility exports=${summary.compatibilityExports}/0, legacy core exports=${summary.legacyCoreExports}/0, Runtime Host exports=${summary.runtimeHostExports}/0, legacy examples=${summary.legacyExampleImports}/0, oversized Context Runtime modules=${summary.oversizedContextRuntimeModules}/0, Legacy HTML export references=${summary.legacyHtmlExportReferences}/0, Legacy Memory references=${summary.legacyMemoryReferences}/0, retired Tool references=${summary.retiredToolReferences}/0, retired runtime-composition files=${summary.retiredRuntimeCompositionFiles}/0, references=${summary.retiredRuntimeCompositionReferences}/0, CLI composition forwarders=${summary.cliCompositionForwarders}/0, CLI public composition edges=${summary.cliCompositionPublicEdges}/0, Desktop-to-CLI composition edges=${summary.desktopCliCompositionEdges}/0, retired CLI Session Host files=${summary.retiredCliSessionHostFiles}/0, references=${summary.retiredCliSessionHostReferences}/0, Coding Agent Session Host protocol references=${summary.codingAgentSessionHostProtocolReferences}/0, retired CLI Runtime Host files=${summary.retiredCliRuntimeHostFiles}/0, references=${summary.retiredCliRuntimeHostReferences}/0, Runtime Host entry ownership references=${summary.runtimeHostEntryOwnershipReferences}/0, Session assembly protocol references=${summary.cliSessionAssemblyProtocolReferences}/0, Composition public exports=${summary.compositionPublicExports}, external deep imports=${summary.externalCompositionDeepImports}/0, package-root exports=${summary.codingAgentRootExportEdges}, disallowed=${summary.codingAgentRootDisallowedExportEdges}/0, retained format boundaries=${summary.retainedFormatBoundaries}, format-to-old edges=${summary.formatBoundaryOldImplementationEdges}/0; domains: ${domains || "none"})`,
				);
			}
		}
	}
}
