/**
 * Freeze the remaining Legacy execution reachability before final retirement.
 * Historical session format readers and Greenfield-shared core capabilities are
 * deliberately reported separately from executable Legacy Agent entrypoints.
 */

import { join } from "node:path";
import ts from "typescript";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

export const LEGACY_EXECUTION_EDGE_BASELINE = Object.freeze([]);

const LEGACY_FORMAT_DOMAIN_PREFIX = "packages/coding-agent/src/sessions/legacy/";

export const LEGACY_FORMAT_BOUNDARY_GROUPS = Object.freeze({
	readers: Object.freeze([
		`${LEGACY_FORMAT_DOMAIN_PREFIX}catalog.ts`,
		`${LEGACY_FORMAT_DOMAIN_PREFIX}document.ts`,
		`${LEGACY_FORMAT_DOMAIN_PREFIX}header-reader.ts`,
		`${LEGACY_FORMAT_DOMAIN_PREFIX}history-reader.ts`,
	]),
	migrations: Object.freeze([
		`${LEGACY_FORMAT_DOMAIN_PREFIX}entry-normalizer.ts`,
		`${LEGACY_FORMAT_DOMAIN_PREFIX}lease.ts`,
		`${LEGACY_FORMAT_DOMAIN_PREFIX}migration.ts`,
	]),
	hostAdapters: Object.freeze([
		"packages/cli-app/src/rpc/cli-session-format-compatibility.ts",
		"packages/cli-app/src/rpc/greenfield-im-legacy-session-migration.ts",
		"packages/cli-app/src/session-compatibility-error.ts",
		"packages/desktop-app/src/main/greenfield-runtime/desktop-legacy-session-format-compatibility.ts",
		"packages/desktop-app/src/main/greenfield-runtime/desktop-historical-session-import-backend.ts",
	]),
	moduleEntries: Object.freeze([`${LEGACY_FORMAT_DOMAIN_PREFIX}index.ts`]),
	publicEntries: Object.freeze(["packages/coding-agent/src/public-api/historical-sessions.ts"]),
});

export const RETAINED_LEGACY_FORMAT_BOUNDARIES = Object.freeze(Object.values(LEGACY_FORMAT_BOUNDARY_GROUPS).flat());

export const LEGACY_SESSION_DATA_MUTATION_BASELINE = Object.freeze([
	Object.freeze({ path: `${LEGACY_FORMAT_DOMAIN_PREFIX}catalog.ts`, symbol: "appendFile", count: 1 }),
	Object.freeze({ path: `${LEGACY_FORMAT_DOMAIN_PREFIX}catalog.ts`, symbol: "rm", count: 2 }),
]);

export const LEGACY_PACKAGE_EXPORT_BASELINE = Object.freeze([]);

export const RETIRED_RUNTIME_SELECTION_MARKERS = Object.freeze([
	"--agent-runtime",
	"VETTA_DESKTOP_AGENT_RUNTIME",
	"VETTA_IM_AGENT_RUNTIME",
	"requestedBackend",
	"effectiveBackend",
	"runtimeDecision",
]);

export const RETIRED_RUNTIME_SELECTION_FILES = Object.freeze([
	"packages/cli-app/src/rpc/legacy-runtime-fallback-contract.ts",
	"packages/desktop-app/src/main/greenfield-runtime/desktop-legacy-session-migration-backend.ts",
	"packages/desktop-app/src/main/greenfield-runtime/desktop-runtime-decision.ts",
	"packages/desktop-app/src/main/greenfield-runtime/desktop-runtime-selector.ts",
]);

/**
 * Greenfield 对 Coding Agent 旧产品 Core 的历史静态依赖预算。
 *
 * 这些边不是 Legacy 执行边，因此仍由本脚本单独报告；它们也不代表允许长期保留。
 * 全量旧实现依赖及归零目标由 check-coding-agent-rewrite-progress.mjs 负责冻结和审查。
 */
export const GREENFIELD_PRODUCT_CORE_EDGE_BUDGET = Object.freeze({
	"product-adapter": 12,
	"composition-wiring": 0,
	"rpc-host-adapter": 2,
	"sdk-compatibility": 0,
});

const PUBLIC_CODING_AGENT_SDK_FORBIDDEN_NAMES =
	/\b(?:(?:Greenfield|Legacy)[A-Za-z0-9_]*|ModelRegistry|ResourceLoader|SessionManager|SettingsManager)\b/;

const EXTERNAL_RUNTIME_HOST_SPECIFIER = "@vetta/coding-agent/runtime-host";
const EXTERNAL_CONCRETE_RUNTIME_ADAPTER_NAMES = new Set([
	"CodingAgentGreenfieldBranchNavigationHost",
	"CodingAgentGreenfieldExtensionCommandHost",
	"CodingAgentGreenfieldExtensionEventHost",
	"CodingAgentGreenfieldExtensionObservationAdapter",
	"CodingAgentGreenfieldResourceReloadHost",
	"CodingAgentGreenfieldSessionCapabilityHost",
	"CodingAgentGreenfieldTurnExecutor",
	"CodingAgentGreenfieldTurnRetryController",
	"createCodingAgentGreenfieldExtensionCommandActions",
	"projectCodingAgentGreenfieldMessages",
]);

export const RETIRED_LEGACY_EXECUTION_FILES = Object.freeze([
	"packages/coding-agent/src/core/agent-session.ts",
	"packages/coding-agent/src/core/sdk.ts",
	"packages/coding-agent/src/cli.ts",
	"packages/coding-agent/src/main.ts",
	"packages/coding-agent/src/modes/legacy-print-session-adapter.ts",
	"packages/coding-agent/src/public-api/legacy-cli.ts",
	"packages/coding-agent/src/public-api/legacy-host-services.ts",
	"packages/coding-agent/src/public-api/legacy-session.ts",
	"packages/coding-agent/src/public-api/legacy-tools.ts",
	"packages/coding-agent/src/adapters/runtime-core/composition.ts",
	"packages/coding-agent/src/adapters/runtime-core/legacy-session-backend.ts",
	"packages/coding-agent/src/adapters/runtime-core/legacy-session-ports.ts",
	"packages/coding-agent/src/adapters/runtime-core/legacy-session-services.ts",
	"packages/coding-agent/src/adapters/runtime-core/session-events.ts",
	"packages/coding-agent/src/composition/legacy-knowledge-processing-session.ts",
]);

export const RETIRED_LEGACY_SESSION_SUPPORT_FILES = Object.freeze([
	"packages/coding-agent/src/adapters/runtime-core/coding-agent-legacy-session-migration.ts",
	"packages/coding-agent/src/adapters/runtime-core/legacy-session-import-normalizer.ts",
	"packages/coding-agent/src/adapters/runtime-core/legacy-session-format/setup-writer.ts",
	"packages/coding-agent/src/adapters/runtime-core/legacy-session-setup-seed-importer.ts",
	"packages/coding-agent/src/core/agent-mode.ts",
	"packages/coding-agent/src/core/mode-prompt.ts",
	"packages/coding-agent/src/core/modes-data.ts",
	"packages/coding-agent/src/core/personas-data.ts",
	"packages/coding-agent/src/core/personas.ts",
	"packages/coding-agent/src/core/session/session-stats.ts",
	"packages/coding-agent/src/core/session/skill-expansion.ts",
	"packages/coding-agent/src/core/session/system-prompt-builder.ts",
	"packages/coding-agent/src/core/session/todo-continuation.ts",
]);

export const RETIRED_LEGACY_SESSION_PREFIXES = Object.freeze([
	"packages/coding-agent/src/adapters/runtime-core/legacy-session-format/",
	"packages/coding-agent/src/core/session-manager/",
]);

const LEGACY_SESSION_COMPATIBILITY_SHIMS = Object.freeze({
	"packages/coding-agent/src/core/session/tool-scope.ts":
		/\b(?:function resolveActiveToolNames|const ALL_SCENARIOS)\b/u,
	"packages/coding-agent/src/core/todo-store.ts": /\b(?:class TodoStore|const TODO_SNAPSHOT_TYPE)\b/u,
});

const RETIRED_LEGACY_SESSION_TEST_IMPORT =
	/(?:^|\/)src\/core\/(?:agent-mode|agent-session|sdk|session-manager(?:\/|\.))|(?:^|\/)src\/core\/session\/(?:background-task-controller|bash-controller|compaction-controller|event-router|extension-binding|input-pipeline|model-controller|normalize-images|queue-controller|retry-controller|runtime-manager|session-context|session-navigator|session-operation-gate|session-stats|skill-expansion|subagent-controller|system-prompt-builder|todo-continuation|todo-controller|types)(?:\.js)?/u;

const LEGACY_EXECUTION_SYMBOL_KINDS = new Map([
	["LegacyCodingAgentSessionBackend", "legacy-session-backend"],
	["createLegacyRuntimeHostOptions", "legacy-host-composition"],
	["createLegacyKnowledgeProcessingSessionFactory", "legacy-knowledge-execution"],
	["runLegacyRuntimeExecution", "legacy-cli-activation"],
	["createDesktopLegacyExecutionCompatibility", "desktop-legacy-execution-activation"],
]);

const LEGACY_SETUP_SEED_SYMBOL = /\b(?:CodingAgentLegacySessionSetupSeedImporter|LegacySessionSetupWriter)\b/u;
const LEGACY_SESSION_MIGRATION_ADAPTER = `${LEGACY_FORMAT_DOMAIN_PREFIX}migration.ts`;
const LEGACY_SESSION_DATA_MUTATION_SYMBOLS = new Set([
	"appendFile",
	"appendFileSync",
	"rm",
	"writeFile",
	"writeFileSync",
]);

export function findLegacyExecutionRetirementViolations(
	files,
	{ cliAppBin, codingAgentBin, requireBaseline = false, packageExports } = {},
) {
	const violations = [];
	violations.push(...findLegacySetupSeedViolations(files));
	violations.push(...findLegacyFormatBoundaryClassificationViolations(files));
	const sourcePaths = new Set(files.map((file) => file.path));
	const classifiedEdges = files.flatMap((file) =>
		collectModuleEdges(file.path, file.text).flatMap((moduleEdge) =>
			classifyLegacyExecutionEdge(moduleEdge).map((kind) => ({ ...moduleEdge, kind })),
		),
	);

	for (const actual of classifiedEdges) {
		if (LEGACY_EXECUTION_EDGE_BASELINE.some((allowed) => sameEdge(actual, allowed))) continue;
		violations.push(
			`${actual.path}: Legacy execution dependency is outside the retirement baseline (${actual.kind} from ${actual.specifier})`,
		);
	}

	for (const file of files) {
		if (!file.path.startsWith(LEGACY_FORMAT_DOMAIN_PREFIX)) {
			continue;
		}
		for (const moduleEdge of collectModuleEdges(file.path, file.text)) {
			if (
				moduleEdge.specifier.includes("agent-session") ||
				moduleEdge.specifier.includes("/sdk") ||
				moduleEdge.specifier.includes("legacy-session-backend") ||
				moduleEdge.names.some((name) =>
					["AgentSession", "createAgentSession", "LegacyCodingAgentSessionBackend", "ModelRegistry"].includes(
						name,
					),
				)
			) {
				violations.push(
					`${file.path}: retained Legacy format boundary must not depend on Legacy execution (${moduleEdge.specifier})`,
				);
			}
		}
	}

	if (requireBaseline) {
		for (const retiredPath of RETIRED_RUNTIME_SELECTION_FILES) {
			if (sourcePaths.has(retiredPath))
				violations.push(`${retiredPath}: retired Runtime selection file was restored`);
		}
		for (const retiredPath of [...RETIRED_LEGACY_EXECUTION_FILES, ...RETIRED_LEGACY_SESSION_SUPPORT_FILES]) {
			if (sourcePaths.has(retiredPath)) violations.push(`${retiredPath}: retired Legacy CLI source was restored`);
		}
		for (const retiredPrefix of RETIRED_LEGACY_SESSION_PREFIXES) {
			for (const sourcePath of sourcePaths) {
				if (sourcePath.startsWith(retiredPrefix)) {
					violations.push(`${sourcePath}: retired Legacy Session implementation was restored`);
				}
			}
		}
		for (const expected of LEGACY_EXECUTION_EDGE_BASELINE) {
			if (!classifiedEdges.some((actual) => sameEdge(actual, expected))) {
				violations.push(
					`${expected.path}: expected Legacy execution baseline edge is missing (${expected.kind} from ${expected.specifier})`,
				);
			}
		}
		for (const retainedPath of RETAINED_LEGACY_FORMAT_BOUNDARIES) {
			if (!sourcePaths.has(retainedPath)) {
				violations.push(`${retainedPath}: retained Legacy format boundary is missing`);
			}
		}
		const mutations = collectLegacySessionDataMutations(files);
		for (const expected of LEGACY_SESSION_DATA_MUTATION_BASELINE) {
			const actual = mutations.find(
				(candidate) => candidate.path === expected.path && candidate.symbol === expected.symbol,
			);
			if (actual?.count !== expected.count) {
				violations.push(
					`${expected.path}: Legacy session data mutation baseline changed (${expected.symbol}: ${actual?.count ?? 0} != ${expected.count})`,
				);
			}
		}
		for (const actual of mutations) {
			if (
				!LEGACY_SESSION_DATA_MUTATION_BASELINE.some(
					(expected) => expected.path === actual.path && expected.symbol === actual.symbol,
				)
			) {
				violations.push(
					`${actual.path}: unclassified Legacy session data mutation (${actual.symbol}, count=${actual.count})`,
				);
			}
		}
		const actualExports = Object.keys(packageExports ?? {})
			.filter((key) => key.startsWith("./legacy/"))
			.sort();
		if (actualExports.join("\0") !== [...LEGACY_PACKAGE_EXPORT_BASELINE].sort().join("\0")) {
			violations.push(
				`packages/coding-agent/package.json: Legacy package exports changed without updating the retirement baseline (${actualExports.join(", ") || "none"})`,
			);
		}
		violations.push(...findCanonicalExecutableOwnershipViolations({ cliAppBin, codingAgentBin }));
		violations.push(...findLegacySessionCompatibilityShimViolations(files));
	}

	return violations;
}

export function findRetiredRuntimeSelectionViolations(files) {
	return files
		.filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file.path))
		.flatMap((file) =>
			RETIRED_RUNTIME_SELECTION_MARKERS.flatMap((marker) =>
				file.text.includes(marker) ? [`${file.path}: retired Runtime selection marker (${marker})`] : [],
			),
		);
}

export function findLegacyFormatBoundaryClassificationViolations(files) {
	const retained = new Set(RETAINED_LEGACY_FORMAT_BOUNDARIES);
	return files
		.filter((file) => file.path.startsWith(LEGACY_FORMAT_DOMAIN_PREFIX) && !retained.has(file.path))
		.map((file) => `${file.path}: Legacy format boundary has no compatibility classification`);
}

export function collectLegacySessionDataMutations(files) {
	const counts = new Map();
	for (const file of files) {
		if (!file.path.startsWith(LEGACY_FORMAT_DOMAIN_PREFIX)) continue;
		const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKind(file.path));
		const visit = (node) => {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				LEGACY_SESSION_DATA_MUTATION_SYMBOLS.has(node.expression.text)
			) {
				const key = `${file.path}\0${node.expression.text}`;
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}
	return [...counts.entries()]
		.map(([key, count]) => {
			const [path, symbol] = key.split("\0");
			return { path, symbol, count };
		})
		.sort((left, right) => left.path.localeCompare(right.path) || left.symbol.localeCompare(right.symbol));
}

/** Native Extension setup must never be routed back through generated Legacy JSONL. */
export function findLegacySetupSeedViolations(files) {
	const violations = [];
	for (const file of files) {
		if (LEGACY_SETUP_SEED_SYMBOL.test(file.text)) {
			violations.push(`${file.path}: retired Legacy Session setup seed implementation was restored`);
		}
		if (file.path !== LEGACY_SESSION_MIGRATION_ADAPTER && /\bmigrateLegacySessionToV2\b/u.test(file.text)) {
			violations.push(`${file.path}: native Session setup must not use Legacy Session migration`);
		}
	}
	return violations;
}

export function findLegacySessionCompatibilityShimViolations(files) {
	const sourceByPath = new Map(files.map((file) => [file.path, file.text]));
	const violations = [];
	for (const [path, forbiddenRuntimeImplementation] of Object.entries(LEGACY_SESSION_COMPATIBILITY_SHIMS)) {
		const text = sourceByPath.get(path);
		if (text === undefined) continue;
		if (forbiddenRuntimeImplementation.test(text)) {
			violations.push(`${path}: compatibility shim restored Legacy Session runtime behavior`);
		}
	}
	return violations;
}

export function findRetiredLegacySessionTestImportViolations(files) {
	return files
		.filter((file) =>
			collectDeclaredModuleSpecifiers(file.path, file.text).some((specifier) =>
				RETIRED_LEGACY_SESSION_TEST_IMPORT.test(specifier),
			),
		)
		.map((file) => `${file.path}: test imports a retired Legacy Session implementation`);
}

export function collectExternalRuntimeHostEdges(files) {
	return collectExternalRuntimeModuleEdges(files).filter(
		(edge) =>
			edge.specifier === EXTERNAL_RUNTIME_HOST_SPECIFIER ||
			edge.specifier.startsWith(`${EXTERNAL_RUNTIME_HOST_SPECIFIER}/`),
	);
}

export function collectExternalConcreteRuntimeAdapterImports(files) {
	return collectExternalRuntimeModuleEdges(files).flatMap((edge) =>
		edge.names
			.filter((name) => EXTERNAL_CONCRETE_RUNTIME_ADAPTER_NAMES.has(name))
			.map((name) => ({ path: edge.path, specifier: edge.specifier, name })),
	);
}

export function findRuntimePublicBoundaryViolations(files) {
	return [
		...collectExternalRuntimeHostEdges(files).map(
			(edge) =>
				`${edge.path}: external Runtime host must use @vetta/coding-agent/runtime or @vetta/coding-agent/host-services (${edge.specifier})`,
		),
		...collectExternalConcreteRuntimeAdapterImports(files).map(
			(edge) => `${edge.path}: external Runtime host imports concrete adapter (${edge.name} from ${edge.specifier})`,
		),
	];
}

function collectDeclaredModuleSpecifiers(path, text) {
	const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
	const specifiers = [];
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
			specifiers.push(statement.moduleSpecifier.text);
		}
		if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
			specifiers.push(statement.moduleSpecifier.text);
		}
	}
	return specifiers;
}

export function findCanonicalExecutableOwnershipViolations({ cliAppBin, codingAgentBin } = {}) {
	const violations = [];
	if (codingAgentBin !== undefined) {
		violations.push("packages/coding-agent/package.json: coding-agent must not publish executable bins");
	}
	if (cliAppBin?.["vetta-agent"] !== "dist/agent-cli.js") {
		violations.push("packages/cli-app/package.json: vetta-agent must resolve to dist/agent-cli.js");
	}
	return violations;
}

export function collectGreenfieldSharedCoreImports(files) {
	return collectGreenfieldProductCoreEdges(files).map(({ path, specifier }) => `${path} -> ${specifier}`);
}

export function collectGreenfieldProductCoreEdges(files) {
	return files
		.filter((file) => isGreenfieldSource(file.path))
		.flatMap((file) =>
			collectModuleEdges(file.path, file.text)
				.filter((moduleEdge) => /(?:^|\/)core\//.test(moduleEdge.specifier))
				.map((moduleEdge) => ({
					...moduleEdge,
					classification: classifyGreenfieldProductCoreEdge(moduleEdge.path),
					target: readGreenfieldProductCoreTarget(moduleEdge.specifier),
				})),
		)
		.filter(
			(value, index, values) =>
				values.findIndex(
					(candidate) => candidate.path === value.path && candidate.specifier === value.specifier,
				) === index,
		)
		.sort((left, right) => left.path.localeCompare(right.path) || left.specifier.localeCompare(right.specifier));
}

export function summarizeGreenfieldProductCoreEdges(edges) {
	const summary = {
		"product-adapter": 0,
		"composition-wiring": 0,
		"rpc-host-adapter": 0,
		"sdk-compatibility": 0,
		unclassified: 0,
	};
	for (const edge of edges) summary[edge.classification] += 1;
	return Object.freeze(summary);
}

export function findGreenfieldProductCoreBoundaryViolations(files) {
	const edges = collectGreenfieldProductCoreEdges(files);
	const summary = summarizeGreenfieldProductCoreEdges(edges);
	const violations = [];

	for (const edge of edges) {
		if (edge.classification === "unclassified") {
			violations.push(
				`${edge.path}: Greenfield product Core dependency has no boundary classification (${edge.specifier})`,
			);
		}
		if (edge.target === "agent-session" || edge.target === "sdk") {
			violations.push(
				`${edge.path}: Greenfield must not depend on retired AgentSession execution (${edge.specifier})`,
			);
		}
		if (edge.path.includes("/composition/") && edge.path.endsWith("-contract.ts")) {
			violations.push(
				`${edge.path}: Greenfield Composition contract leaks a concrete product Core type (${edge.specifier})`,
			);
		}
	}

	for (const [classification, budget] of Object.entries(GREENFIELD_PRODUCT_CORE_EDGE_BUDGET)) {
		if (summary[classification] > budget) {
			violations.push(
				`Greenfield ${classification} product Core dependency budget increased (${summary[classification]} > ${budget})`,
			);
		}
	}
	return violations;
}

/** 公共 SDK 门面只能暴露稳定产品合同，不能回接迁移实现或具体产品管理器。 */
export function findGreenfieldSdkBoundaryViolations(files) {
	const violations = [];
	for (const file of files) {
		if (
			file.path !== "packages/coding-agent/src/public-api/sdk.ts" &&
			!file.path.startsWith("packages/coding-agent/src/public-api/sdk/")
		) {
			continue;
		}
		const forbiddenName = PUBLIC_CODING_AGENT_SDK_FORBIDDEN_NAMES.exec(file.text)?.[0];
		if (forbiddenName) {
			violations.push(`${file.path}: public Coding Agent SDK leaks forbidden name (${forbiddenName})`);
		}
		for (const edge of collectModuleEdges(file.path, file.text)) {
			if (file.path.startsWith("packages/coding-agent/src/public-api/sdk/") && edge.specifier.startsWith("../../")) {
				violations.push(
					`${file.path}: public Coding Agent SDK contract must not depend on internal product source (${edge.specifier})`,
				);
			}
			if (
				edge.specifier.includes("core/agent-session") ||
				edge.specifier.includes("core/sdk") ||
				edge.names.some((name) => name === "AgentSession" || name === "createAgentSession")
			) {
				violations.push(
					`${file.path}: public Coding Agent SDK must not depend on retired AgentSession execution (${edge.specifier})`,
				);
			}
		}
	}
	return violations;
}

function collectModuleEdges(path, text) {
	if (!path.includes("/src/") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return [];
	const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
	const edges = [];
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
			edges.push({
				path,
				specifier: statement.moduleSpecifier.text,
				names: collectImportNames(statement.importClause),
			});
		}
		if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
			edges.push({
				path,
				specifier: statement.moduleSpecifier.text,
				names: collectExportNames(statement.exportClause),
			});
		}
	}
	return edges;
}

function collectExternalRuntimeModuleEdges(files) {
	return files
		.filter(
			(file) => file.path.startsWith("packages/cli-app/src/") || file.path.startsWith("packages/desktop-app/src/"),
		)
		.flatMap((file) => collectModuleEdges(file.path, file.text));
}

function collectImportNames(clause) {
	if (!clause) return [];
	const names = [];
	if (clause.name) names.push("default");
	if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
		for (const element of clause.namedBindings.elements) names.push(element.propertyName?.text ?? element.name.text);
	}
	if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push("*");
	return names;
}

function collectExportNames(clause) {
	if (!clause) return ["*"];
	if (!ts.isNamedExports(clause)) return ["*"];
	return clause.elements.map((element) => element.propertyName?.text ?? element.name.text);
}

function classifyLegacyExecutionEdge(moduleEdge) {
	const kinds = new Set();
	for (const name of moduleEdge.names) {
		const kind = LEGACY_EXECUTION_SYMBOL_KINDS.get(name);
		if (kind) kinds.add(kind);
	}
	if (moduleEdge.specifier === "@vetta/coding-agent/legacy/cli") kinds.add("legacy-cli-entry");
	if (
		moduleEdge.specifier.endsWith("/legacy-session-backend.js") ||
		moduleEdge.specifier === "./legacy-session-backend.js"
	) {
		kinds.add("legacy-session-backend");
	}
	if (moduleEdge.specifier.includes("legacy-knowledge-processing-session")) {
		kinds.add("legacy-knowledge-execution");
	}
	if (
		moduleEdge.specifier.endsWith("/main.js") &&
		moduleEdge.path.startsWith("packages/coding-agent/src/") &&
		moduleEdge.names.some((name) =>
			["main", "createLegacyAgentBootstrap", "runLegacyAgentWithBootstrap"].includes(name),
		)
	) {
		kinds.add("legacy-cli-public");
	}
	if (
		moduleEdge.path === "packages/coding-agent/src/public-api/legacy-session.ts" &&
		moduleEdge.names.some((name) => name === "AgentSession" || name === "SessionManager")
	) {
		kinds.add("legacy-session-public");
	}
	return [...kinds];
}

function isGreenfieldSource(path) {
	return (
		path.includes("/greenfield-") ||
		path.includes("/greenfield/") ||
		path.includes("/greenfield-runtime/") ||
		path.includes("/public-api/sdk/")
	);
}

function classifyGreenfieldProductCoreEdge(path) {
	if (path.includes("/adapters/runtime-core/")) return "product-adapter";
	if (path.includes("/composition/")) return "composition-wiring";
	if (path.includes("/modes/rpc/")) return "rpc-host-adapter";
	if (path.includes("/public-api/sdk/")) return "sdk-compatibility";
	return "unclassified";
}

function readGreenfieldProductCoreTarget(specifier) {
	const match = /(?:^|\/)core\/([^/]+?)(?:\.js)?(?:\/|$)/.exec(specifier);
	return match?.[1] ?? "unknown";
}

function sameEdge(left, right) {
	return left.path === right.path && left.specifier === right.specifier && left.kind === right.kind;
}

function scriptKind(path) {
	if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function readProductionSources() {
	return [
		"packages/coding-agent/src",
		"packages/cli-app/src",
		"packages/desktop-app/src",
		"packages/desktop-app/scripts",
		"packages/im-gateway/cmd",
		"packages/im-gateway/internal",
	]
		.flatMap((root) => walkFiles(join(repoRoot, root)))
		.map((filePath) => ({ path: rel(filePath), text: readText(filePath) }));
}

function readCodingAgentTests() {
	return walkFiles(join(repoRoot, "packages/coding-agent/test")).map((filePath) => ({
		path: rel(filePath),
		text: readText(filePath),
	}));
}

if (isDirectRun(import.meta.url)) {
	const files = readProductionSources();
	const codingAgentPackageJson = JSON.parse(readText(join(repoRoot, "packages/coding-agent/package.json")));
	const cliAppPackageJson = JSON.parse(readText(join(repoRoot, "packages/cli-app/package.json")));
	const violations = findLegacyExecutionRetirementViolations(files, {
		cliAppBin: cliAppPackageJson.bin,
		codingAgentBin: codingAgentPackageJson.bin,
		requireBaseline: true,
		packageExports: codingAgentPackageJson.exports,
	});
	violations.push(...findGreenfieldProductCoreBoundaryViolations(files));
	violations.push(...findGreenfieldSdkBoundaryViolations(files));
	violations.push(...findRuntimePublicBoundaryViolations(files));
	violations.push(...findRetiredRuntimeSelectionViolations(files));
	violations.push(...findRetiredLegacySessionTestImportViolations(readCodingAgentTests()));
	if (violations.length > 0) {
		for (const violation of violations) fail(`[legacy-execution] ${violation}`);
	} else {
		const productCoreEdges = collectGreenfieldProductCoreEdges(files);
		const productCoreSummary = summarizeGreenfieldProductCoreEdges(productCoreEdges);
		const externalRuntimeHostEdges = collectExternalRuntimeHostEdges(files);
		const externalConcreteRuntimeAdapters = collectExternalConcreteRuntimeAdapterImports(files);
		ok(
			`[legacy-execution] ok (${LEGACY_EXECUTION_EDGE_BASELINE.length} execution edge(s), 0 native setup migration edge(s), ${RETAINED_LEGACY_FORMAT_BOUNDARIES.length} retained format boundary(s): readers=${LEGACY_FORMAT_BOUNDARY_GROUPS.readers.length}, migrations=${LEGACY_FORMAT_BOUNDARY_GROUPS.migrations.length}, host=${LEGACY_FORMAT_BOUNDARY_GROUPS.hostAdapters.length}, entries=${LEGACY_FORMAT_BOUNDARY_GROUPS.moduleEntries.length}, public=${LEGACY_FORMAT_BOUNDARY_GROUPS.publicEntries.length}, unclassified=0, data-mutations=${LEGACY_SESSION_DATA_MUTATION_BASELINE.reduce((total, item) => total + item.count, 0)}; ${productCoreEdges.length} Greenfield product-core edge(s): adapter=${productCoreSummary["product-adapter"]}, composition=${productCoreSummary["composition-wiring"]}, rpc=${productCoreSummary["rpc-host-adapter"]}, sdk=${productCoreSummary["sdk-compatibility"]}; ${externalRuntimeHostEdges.length} external runtime-host edge(s), ${externalConcreteRuntimeAdapters.length} external concrete Runtime adapter import(s))`,
		);
	}
}
