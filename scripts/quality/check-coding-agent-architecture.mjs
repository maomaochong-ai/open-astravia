/** Enforce the current Coding Agent dependency direction and public boundaries. */

import { join, posix } from "node:path";
import ts from "typescript";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const SOURCE_ROOT = "packages/coding-agent/src";
const PACKAGE_ROOT = "packages/coding-agent";
const ROOT_ENTRY = `${SOURCE_ROOT}/index.ts`;
const COMPOSITION_ENTRY = `${SOURCE_ROOT}/composition/index.ts`;
const HISTORICAL_ROOT = `${SOURCE_ROOT}/sessions/legacy`;
const PACKAGE_SPECIFIER = "@vetta/coding-agent";

const DOMAIN_ROOTS = Object.freeze([
	`${SOURCE_ROOT}/extensions/`,
	`${SOURCE_ROOT}/memory/`,
	`${SOURCE_ROOT}/mcp/`,
	`${SOURCE_ROOT}/model-context/`,
	`${SOURCE_ROOT}/plugins/`,
	`${SOURCE_ROOT}/resources/`,
	`${SOURCE_ROOT}/sessions/`,
	`${SOURCE_ROOT}/work-state/`,
]);

const COMPOSITION_PUBLIC_SOURCE_ROOTS = Object.freeze([
	`${SOURCE_ROOT}/composition/contracts/`,
	`${SOURCE_ROOT}/composition/session-host/`,
	`${SOURCE_ROOT}/host/runtime-host/`,
	`${SOURCE_ROOT}/sessions/setup/`,
]);
const COMPOSITION_PUBLIC_EXTERNAL_SOURCES = new Set(["@vetta/runtime-storage/conversation"]);

export function collectCodingAgentArchitectureState({ files, packageJson }) {
	const normalizedFiles = files.map((file) => ({ ...file, path: normalizePath(file.path) }));
	const edges = normalizedFiles.flatMap(collectModuleEdges);
	const sourcePaths = normalizedFiles
		.filter((file) => file.path.startsWith(`${SOURCE_ROOT}/`))
		.map((file) => file.path)
		.sort();
	return Object.freeze({
		files: normalizedFiles,
		edges,
		sourcePaths,
		packageExports: Object.keys(packageJson.exports ?? {}).sort(),
	});
}

export function findCodingAgentArchitectureViolations(state) {
	const violations = [];

	for (const path of state.sourcePaths) {
		if (path.startsWith(`${SOURCE_ROOT}/core/`) || path.startsWith(`${SOURCE_ROOT}/compat/`)) {
			violations.push(`${path}: retired implementation directory is outside the current architecture`);
		}
	}

	for (const edge of state.edges) {
		const target = resolveSourceTarget(edge.path, edge.specifier);
		if (edge.path === ROOT_ENTRY && (edge.kind !== "export" || edge.specifier !== "./public-api/extensions.js")) {
			violations.push(`${edge.path}:${edge.line}: package root may only export the Extension facade`);
		}
		if (
			edge.path === COMPOSITION_ENTRY &&
			edge.kind === "export" &&
			!isCompositionPublicSource(target, edge.specifier)
		) {
			violations.push(
				`${edge.path}:${edge.line}: Composition public entry exports an internal implementation (${edge.specifier})`,
			);
		}

		if (!edge.path.startsWith(`${PACKAGE_ROOT}/`) && edge.specifier.startsWith(PACKAGE_SPECIFIER)) {
			if (!isPublishedPackageSpecifier(edge.specifier, state.packageExports)) {
				violations.push(
					`${edge.path}:${edge.line}: consumer uses a non-public Coding Agent subpath (${edge.specifier})`,
				);
			}
		}
		if (edge.names.includes("migrateLegacySessionToV2") && !edge.path.startsWith(`${HISTORICAL_ROOT}/`)) {
			violations.push(`${edge.path}:${edge.line}: historical conversion is outside its owner (${edge.specifier})`);
		}

		if (!target?.startsWith(`${SOURCE_ROOT}/`)) continue;
		if (isContractPath(edge.path) && isImplementationTarget(target)) {
			violations.push(`${edge.path}:${edge.line}: contract depends on implementation (${edge.specifier})`);
		}
		if (
			isDomainPath(edge.path) &&
			(isAdapterPath(target) || isCompositionImplementation(target) || isPublicFacade(target))
		) {
			violations.push(
				`${edge.path}:${edge.line}: product domain depends on orchestration or implementation (${edge.specifier})`,
			);
		}
		if (isAdapterPath(edge.path) && (isCompositionImplementation(target) || isPublicFacade(target))) {
			violations.push(
				`${edge.path}:${edge.line}: Adapter depends on Composition or a public facade (${edge.specifier})`,
			);
		}
		if (edge.path.startsWith(`${HISTORICAL_ROOT}/`) && isHistoricalExecutionTarget(target)) {
			violations.push(
				`${edge.path}:${edge.line}: historical format boundary depends on Agent execution (${edge.specifier})`,
			);
		}
	}

	return violations;
}

function isPublishedPackageSpecifier(specifier, packageExports) {
	if (specifier === PACKAGE_SPECIFIER) return packageExports.includes(".");
	if (!specifier.startsWith(`${PACKAGE_SPECIFIER}/`)) return false;
	const requestedSubpath = `./${specifier.slice(PACKAGE_SPECIFIER.length + 1)}`;
	return packageExports.some((publishedSubpath) => matchesExportSubpath(publishedSubpath, requestedSubpath));
}

function matchesExportSubpath(publishedSubpath, requestedSubpath) {
	if (publishedSubpath === requestedSubpath) return true;
	const wildcardIndex = publishedSubpath.indexOf("*");
	if (wildcardIndex < 0) return false;
	return (
		requestedSubpath.startsWith(publishedSubpath.slice(0, wildcardIndex)) &&
		requestedSubpath.endsWith(publishedSubpath.slice(wildcardIndex + 1))
	);
}

function isCompositionPublicSource(target, specifier) {
	if (!target) return COMPOSITION_PUBLIC_EXTERNAL_SOURCES.has(specifier);
	if (posix.dirname(target) === `${SOURCE_ROOT}/composition`) return true;
	return COMPOSITION_PUBLIC_SOURCE_ROOTS.some((root) => target.startsWith(root));
}

function collectModuleEdges(file) {
	if (!/\.[cm]?[jt]sx?$/.test(file.path)) return [];
	const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKind(file.path));
	const edges = [];
	const addEdge = (node, moduleSpecifier, kind, names) => {
		if (!moduleSpecifier || !ts.isStringLiteralLike(moduleSpecifier)) return;
		edges.push({
			path: file.path,
			specifier: moduleSpecifier.text,
			kind,
			names,
			line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
		});
	};
	const visit = (node) => {
		if (ts.isImportDeclaration(node)) {
			addEdge(node, node.moduleSpecifier, "import", collectImportNames(node.importClause));
		} else if (ts.isExportDeclaration(node)) {
			addEdge(node, node.moduleSpecifier, "export", collectExportNames(node.exportClause));
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1
		) {
			addEdge(node, node.arguments[0], "dynamic-import", ["<dynamic>"]);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
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
	return names;
}

function collectExportNames(clause) {
	if (!clause || !ts.isNamedExports(clause)) return ["*"];
	return clause.elements.map((element) => element.name.text);
}

function isContractPath(path) {
	return (
		path.startsWith(`${SOURCE_ROOT}/runtime-contracts/`) ||
		path.startsWith(`${SOURCE_ROOT}/composition/contracts/`) ||
		path === `${SOURCE_ROOT}/composition/knowledge-processing-contract.ts` ||
		path.endsWith("-contract.ts") ||
		path.endsWith("/contracts.ts") ||
		path.endsWith("/runtime-contracts.ts")
	);
}

function isDomainPath(path) {
	return DOMAIN_ROOTS.some((root) => path.startsWith(root)) && !isContractPath(path);
}

function isAdapterPath(path) {
	return path.startsWith(`${SOURCE_ROOT}/adapters/`);
}

function isPublicContract(path) {
	return path.startsWith(`${SOURCE_ROOT}/public-api/sdk/`) && isContractPath(path);
}

function isPublicFacade(path) {
	return path.startsWith(`${SOURCE_ROOT}/public-api/`) && !isPublicContract(path);
}

function isCompositionImplementation(path) {
	return path.startsWith(`${SOURCE_ROOT}/composition/`) && !isContractPath(path);
}

function isHostImplementation(path) {
	return path.startsWith(`${SOURCE_ROOT}/host/`) && !isContractPath(path);
}

function isImplementationTarget(path) {
	return (
		isAdapterPath(path) || isCompositionImplementation(path) || isHostImplementation(path) || isPublicFacade(path)
	);
}

function isHistoricalExecutionTarget(path) {
	return (
		isAdapterPath(path) ||
		path.startsWith(`${SOURCE_ROOT}/composition/`) ||
		path.startsWith(`${SOURCE_ROOT}/host/`) ||
		path.startsWith(`${SOURCE_ROOT}/modes/`) ||
		path.startsWith(`${SOURCE_ROOT}/public-api/sdk`)
	);
}

function resolveSourceTarget(sourcePath, specifier) {
	if (!specifier.startsWith(".")) return undefined;
	return posix.normalize(posix.join(posix.dirname(sourcePath), specifier)).replace(/\.js$/, ".ts");
}

function scriptKind(path) {
	if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function normalizePath(path) {
	return path.replaceAll("\\", "/");
}

function readCurrentInput() {
	const packagePath = join(repoRoot, PACKAGE_ROOT, "package.json");
	const codingAgentFiles = walkFiles(join(repoRoot, SOURCE_ROOT), { extensions: [".ts", ".tsx"] }).map((path) => ({
		path: rel(path),
		text: readText(path),
	}));
	const consumerFiles = walkFiles(join(repoRoot, "packages"), {
		extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
	})
		.filter((path) => !normalizePath(path).includes("/node_modules/") && !normalizePath(path).includes("/dist/"))
		.map((path) => ({ path: rel(path), text: readText(path) }))
		.filter((file) => !file.path.startsWith(`${PACKAGE_ROOT}/`) && file.text.includes("@vetta/coding-agent"));
	return {
		files: [...codingAgentFiles, ...consumerFiles],
		packageJson: JSON.parse(readText(packagePath)),
	};
}

if (isDirectRun(import.meta.url)) {
	const state = collectCodingAgentArchitectureState(readCurrentInput());
	const violations = findCodingAgentArchitectureViolations(state);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[coding-agent-architecture] ${violation}`);
	} else {
		ok(
			`[coding-agent-architecture] ok (source files=${state.sourcePaths.length}, module edges=${state.edges.length}, manifest exports=${state.packageExports.length})`,
		);
	}
}
