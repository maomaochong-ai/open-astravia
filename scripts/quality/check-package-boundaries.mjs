/**
 * Enforce monorepo dependency direction (apps may depend on libs; libs must not
 * depend on apps / host packages).
 *
 * Rules (see README "依赖方向"):
 * - Core/runtime/libs must not import desktop-app, admin, site, cli-app
 * - plugins/** must not deep-import desktop-app internals
 * - packages must not import another package's test/ tree
 * - runtime-core production code must not import coding-agent adapters
 *
 * Usage:
 *   bun run scripts/quality/check-package-boundaries.mjs
 */

import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

/** Reusable package prefixes that must not depend on concrete applications. */
const LIB_PREFIXES = [
	"packages/capability-sdk/",
	"packages/capability-runtime/",
	"packages/ai/",
	"packages/agent/",
	"packages/coding-agent/",
	"packages/ecosystem-adapter/",
	"packages/runtime-core/",
	"packages/runtime-knowledge/",
	"packages/runtime-tools/",
	"packages/runtime-storage/",
	"packages/runtime-node/",
	"packages/runtime-mcp/",
	"packages/runtime-telemetry/",
	"packages/runtime-desktop/",
	"packages/action-rpc/",
	"packages/toolkit/",
	"packages/theme-sdk/",
	"packages/theme-ui/",
	"packages/markdown/",
	"packages/ui/",
	"packages/plugins/plugin-sdk/",
	"packages/plugins/plugin-vite/",
];

const MANIFEST_TRUTH_PACKAGE_NAMES = new Set([
	"@astravia/coding-agent",
	"@astravia/runtime-knowledge",
	"@astravia/runtime-storage",
	"@astravia/runtime-node",
	"@astravia/runtime-tools",
	"@astravia/runtime-desktop",
	"@astravia/cli-host",
	"@astravia/desktop",
]);

const RETIRED_CODING_AGENT_TOOL_EXPORTS = new Set([
	"bashTool",
	"codingTools",
	"createAskUserQuestionTool",
	"createBashTool",
	"createCodingTools",
	"createEditTool",
	"createExtractTextFromImgTool",
	"createExtractTextFromPdfTool",
	"createFindTool",
	"createGlobTool",
	"createGrepTool",
	"createHtmlToPdfTool",
	"createImSendAttachmentTool",
	"createKbFilterByTagsTool",
	"createKbListTagsTool",
	"createKbWritePageTool",
	"createLsTool",
	"createProgressTool",
	"createReadOnlyTools",
	"createReadTool",
	"createRenderPdfPageTool",
	"createShellTool",
	"createTaskOutputTool",
	"createTaskStopTool",
	"createToolSearchTool",
	"createTreeTool",
	"createWriteTool",
	"editTool",
	"extractTextFromImgTool",
	"extractTextFromPdfTool",
	"findTool",
	"globTool",
	"grepTool",
	"htmlToPdfTool",
	"kbFilterByTagsTool",
	"kbListTagsTool",
	"kbWritePageTool",
	"lsTool",
	"progressTool",
	"readOnlyTools",
	"readTool",
	"renderPdfPageTool",
	"shellTool",
	"treeTool",
	"writeTool",
]);

function isLibFile(posixPath) {
	return LIB_PREFIXES.some((prefix) => posixPath.startsWith(prefix));
}

function isPluginPackageFile(posixPath) {
	return posixPath.startsWith("packages/plugins/presets/") || posixPath.startsWith("packages/plugins/externals/");
}

function scriptKind(filePath) {
	if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
		return ts.ScriptKind.JS;
	}
	return ts.ScriptKind.TS;
}

export function collectImportSpecifiers(filePath, text) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
	const specifiers = [];
	const add = (node) => {
		if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
	};
	const visit = (node) => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			add(node.moduleSpecifier);
		} else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
			add(node.moduleReference.expression);
		} else if (ts.isCallExpression(node) && node.arguments.length === 1) {
			const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
			const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
			if (isDynamicImport || isRequire) add(node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return specifiers;
}

function collectRuntimeImportSpecifiers(filePath, text) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
	const specifiers = [];
	const add = (node) => {
		if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
	};
	const hasRuntimeImport = (node) => {
		const clause = node.importClause;
		if (!clause) return true;
		if (clause.isTypeOnly) return false;
		if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return true;
		return (
			clause.namedBindings.elements.length === 0 ||
			clause.namedBindings.elements.some((element) => !element.isTypeOnly)
		);
	};
	const hasRuntimeExport = (node) => {
		if (node.isTypeOnly) return false;
		if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return true;
		return (
			node.exportClause.elements.length === 0 || node.exportClause.elements.some((element) => !element.isTypeOnly)
		);
	};
	const visit = (node) => {
		if (ts.isImportDeclaration(node)) {
			if (hasRuntimeImport(node)) add(node.moduleSpecifier);
		} else if (ts.isExportDeclaration(node)) {
			if (hasRuntimeExport(node)) add(node.moduleSpecifier);
		} else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
			if (!node.isTypeOnly) add(node.moduleReference.expression);
		} else if (ts.isCallExpression(node) && node.arguments.length === 1) {
			const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
			const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
			if (isDynamicImport || isRequire) add(node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return specifiers;
}

function collectCapabilityIdLiterals(filePath, text) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
	const capabilityIds = [];
	const visit = (node) => {
		if (ts.isStringLiteralLike(node) && /^cap\.(?:foundation|domain)\./.test(node.text)) {
			capabilityIds.push(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return capabilityIds;
}

function usesDesktopPluginGlobal(filePath, text) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
	let found = false;
	const visit = (node) => {
		if (
			ts.isPropertyAccessExpression(node) &&
			node.name.text === "astravia" &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "window"
		) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found;
}

function forbiddenAppId(specifier) {
	const normalized = specifier.replaceAll("\\", "/");
	for (const packageName of ["@astravia/desktop", "@astravia/cli-host", "@astravia/site", "shadcn-admin"]) {
		if (normalized === packageName || normalized.startsWith(`${packageName}/`)) return packageName;
	}
	const match = normalized.match(/(?:^|\/)(desktop|cli-host|admin|site)(?:\/|$)/);
	return match?.[1] ? `${match[1]} path` : null;
}

function checkForbiddenAppImports(posixPath, specifiers, findings) {
	if (!isLibFile(posixPath) && !isPluginPackageFile(posixPath)) return;
	for (const specifier of specifiers) {
		const id = forbiddenAppId(specifier);
		if (id) findings.push(`${posixPath}: libs/plugins must not import app package (${id})`);
	}
}

function checkTestTreeImports(posixPath, specifiers, findings) {
	const isTestFile = posixPath.includes("/test/") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(posixPath);
	if (isTestFile) return;
	for (const specifier of specifiers) {
		const normalized = specifier.replaceAll("\\", "/");
		if (/(?:^|\/)test(?:\/|$)/.test(normalized)) {
			findings.push(`${posixPath}: production code must not import test trees (${specifier})`);
		}
	}
}

function checkPluginDesktopDeepImport(posixPath, specifiers, findings) {
	if (!isPluginPackageFile(posixPath)) return;
	if (specifiers.some((specifier) => /(?:^|\/)desktop\/src\//.test(specifier) || specifier.startsWith("@/main/"))) {
		findings.push(`${posixPath}: plugins must not deep-import desktop internals`);
	}
}

function checkDesktopCliSourceImports(posixPath, specifiers, findings) {
	if (!posixPath.startsWith("apps/desktop/src/")) return;
	for (const specifier of specifiers) {
		const normalized = specifier.replaceAll("\\", "/");
		if (normalized.includes("cli-host/src/")) {
			findings.push(`${posixPath}: desktop must consume cli-host through a package export (${specifier})`);
		}
	}
}

function checkDesktopRendererMcpImports(posixPath, text, findings) {
	if (!posixPath.startsWith("apps/desktop/src/renderer/")) return;
	for (const specifier of collectRuntimeImportSpecifiers(posixPath, text)) {
		if (specifier === "@astravia/runtime-mcp/browser") continue;
		if (specifier === "@astravia/runtime-mcp" || specifier.startsWith("@astravia/runtime-mcp/")) {
			findings.push(
				`${posixPath}: desktop renderer must import MCP runtime values from @astravia/runtime-mcp/browser (${specifier})`,
			);
		}
	}
}

function checkPluginDesktopGlobal(posixPath, text, findings) {
	if (!isPluginPackageFile(posixPath) || posixPath.endsWith(".d.ts")) return;
	// Explicit exceptions that must touch the host Desktop API surface:
	// - plugin-workbench: trusted host management UI (install/dev-watch)
	// - security-probe: intentional audit of window.astravia bypass / trust boundary
	if (posixPath.startsWith("packages/plugins/presets/plugin-workbench/")) return;
	if (posixPath.startsWith("packages/plugins/externals/security-probe/")) return;
	if (usesDesktopPluginGlobal(posixPath, text)) {
		findings.push(`${posixPath}: plugins must use the public plugin SDK instead of window.astravia`);
	}
}

function checkCapabilityLayerImports(posixPath, specifiers, findings) {
	const isCapabilitySdk = posixPath.startsWith("packages/capability-sdk/");
	const isCapabilityRuntime = posixPath.startsWith("packages/capability-runtime/");
	if (!isCapabilitySdk && !isCapabilityRuntime) return;

	const forbiddenPrefixes = [
		"@astravia-org/plugin-sdk",
		"@astravia/action-rpc",
		"@astravia/desktop",
		"@astravia-org/theme-sdk",
		"@astravia-org/theme-ui",
	];
	if (isCapabilitySdk) forbiddenPrefixes.push("@astravia/capability-runtime");
	for (const specifier of specifiers) {
		if (forbiddenPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
			findings.push(
				`${posixPath}: capability internals must not import public system SDKs or app packages (${specifier})`,
			);
		}
	}
}

function checkPublicSystemSdkImports(posixPath, specifiers, findings) {
	const isPublicSystemSdk =
		posixPath.startsWith("packages/theme-sdk/") || posixPath.startsWith("packages/plugins/plugin-sdk/");
	if (!isPublicSystemSdk) return;
	for (const specifier of specifiers) {
		if (specifier.startsWith("@astravia-org/capability-sdk/internal/")) {
			findings.push(`${posixPath}: public system SDKs must not expose built-in capability adapters (${specifier})`);
		}
	}
}

function checkRawCapabilityIds(posixPath, text, findings) {
	const isCapabilityDefinition =
		posixPath === "packages/capability-sdk/src/contracts.ts" ||
		posixPath.startsWith("packages/capability-sdk/src/domain/") ||
		posixPath.startsWith("packages/capability-sdk/src/foundation/");
	if (isCapabilityDefinition) return;
	for (const capabilityId of collectCapabilityIdLiterals(posixPath, text)) {
		findings.push(`${posixPath}: import a capability token instead of using raw id ${capabilityId}`);
	}
}

function checkCapabilitySchemaDefinitions(posixPath, text, findings) {
	const isCapabilityDefinition =
		posixPath.startsWith("packages/capability-sdk/src/domain/") ||
		posixPath.startsWith("packages/capability-sdk/src/foundation/");
	if (!isCapabilityDefinition || !text.includes("defineCapability<")) return;
	if (/\bparse(?:Input|Output)\s*:/.test(text)) {
		findings.push(`${posixPath}: capability tokens must use schema-backed input and output definitions`);
	}
	if (!text.includes("createCapabilityCatalog")) {
		findings.push(`${posixPath}: capability definition files must publish a generated catalog`);
	}
}

function checkGreenfieldRuntimeImports(posixPath, specifiers, findings) {
	const isGreenfieldRuntime =
		posixPath.startsWith("packages/runtime-storage/src/conversation/") ||
		posixPath.startsWith("packages/runtime-knowledge/src/") ||
		posixPath.startsWith("packages/runtime-tools/src/coding/") ||
		posixPath.startsWith("packages/runtime-mcp/src/");
	if (!isGreenfieldRuntime) return;
	for (const specifier of specifiers) {
		if (specifier === "@astravia/coding-agent" || specifier.startsWith("@astravia/coding-agent/")) {
			findings.push(`${posixPath}: greenfield runtime modules must not import coding-agent (${specifier})`);
		}
	}
}

function checkStorageProtocolImports(posixPath, specifiers, findings) {
	if (!posixPath.startsWith("packages/runtime-storage/src/")) return;
	for (const specifier of specifiers) {
		if (
			specifier.startsWith("node:") ||
			specifier === "@astravia/runtime-node" ||
			specifier.startsWith("@astravia/runtime-node/") ||
			specifier === "@astravia/runtime-desktop" ||
			specifier.startsWith("@astravia/runtime-desktop/")
		) {
			findings.push(`${posixPath}: runtime-storage protocol must not import platform implementation (${specifier})`);
		}
	}
}

function checkToolsProtocolImports(posixPath, specifiers, findings) {
	if (!posixPath.startsWith("packages/runtime-tools/src/")) return;
	for (const specifier of specifiers) {
		if (
			specifier.startsWith("node:") ||
			specifier === "@astravia/runtime-node" ||
			specifier.startsWith("@astravia/runtime-node/") ||
			specifier === "@astravia/runtime-desktop" ||
			specifier.startsWith("@astravia/runtime-desktop/")
		) {
			findings.push(`${posixPath}: runtime-tools protocol must not import platform implementation (${specifier})`);
		}
	}
}

function checkMcpProtocolImports(posixPath, specifiers, findings) {
	if (!posixPath.startsWith("packages/runtime-mcp/src/")) return;
	for (const specifier of specifiers) {
		if (
			specifier.startsWith("node:") ||
			specifier === "@astravia/runtime-node" ||
			specifier.startsWith("@astravia/runtime-node/") ||
			specifier === "@astravia/runtime-desktop" ||
			specifier.startsWith("@astravia/runtime-desktop/")
		) {
			findings.push(`${posixPath}: runtime-mcp protocol must not import platform implementation (${specifier})`);
		}
	}
}

function checkRuntimeCorePlatformImports(posixPath, text, specifiers, findings) {
	if (!posixPath.startsWith("packages/runtime-core/src/")) return;
	for (const specifier of specifiers) {
		if (
			specifier.startsWith("node:") ||
			specifier === "@astravia/runtime-node" ||
			specifier.startsWith("@astravia/runtime-node/") ||
			specifier === "@astravia/runtime-desktop" ||
			specifier.startsWith("@astravia/runtime-desktop/")
		) {
			findings.push(
				`${posixPath}: runtime-core must use host ports instead of platform implementation (${specifier})`,
			);
		}
	}

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenGlobals = new Set(["Buffer", "Bun", "process"]);
	const foundGlobals = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) foundGlobals.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	for (const symbol of foundGlobals) {
		findings.push(`${posixPath}: runtime-core must not depend on platform global (${symbol})`);
	}
}

function checkRuntimeProductSemanticBoundary(posixPath, text, findings) {
	const isRuntimeProductBoundary =
		posixPath.startsWith("packages/runtime-core/src/") ||
		posixPath.startsWith("packages/runtime-tools/src/coding/") ||
		posixPath.startsWith("packages/runtime-node/src/coding/");
	if (!isRuntimeProductBoundary) return;

	const forbiddenSymbols = new Set([
		"AskUserQuestion",
		"BackgroundTaskInfo",
		"CodingToolCategory",
		"ConversationScenario",
		"McpReloadEndEvent",
		"McpReloadStartEvent",
		"McpStatusEvent",
		"RuntimeSubagentSnapshot",
		"RuntimeSubagentUsageSnapshot",
		"SubagentInfo",
		"agentMode",
		"enableSubagents",
		"interactiveResume",
	]);
	const forbiddenLiterals = new Set([
		"background_tasks_update",
		"mcp.reload.end",
		"mcp.reload.start",
		"mcp.status",
		"scene_expansion",
		"settings_assist_marker",
		"skill_expansion",
		"subagents_update",
	]);
	const forbiddenProductText = [/\bSKILL\.md\b/i, /\binvoke_skill\b/i, /\bknowledge wiki\b/i];
	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const found = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			found.add(node.text);
		}
		if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
			if (forbiddenLiterals.has(node.text)) found.add(node.text);
			for (const pattern of forbiddenProductText) {
				if (pattern.test(node.text)) found.add(node.text);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	for (const semantic of found) {
		findings.push(
			`${posixPath}: Runtime must expose generic extension/platform contracts instead of product semantic (${semantic})`,
		);
	}
}

function checkCodingAgentRootImports(posixPath, specifiers, findings) {
	const isInternalConsumer =
		(posixPath.startsWith("packages/") || posixPath.startsWith("apps/")) &&
		!posixPath.startsWith("packages/coding-agent/");
	const hasStricterProductionBoundary =
		posixPath.startsWith("packages/agent/src/") ||
		posixPath.startsWith("packages/runtime-core/src/") ||
		posixPath.startsWith("packages/runtime-storage/src/conversation/") ||
		posixPath.startsWith("packages/runtime-tools/src/coding/") ||
		posixPath.startsWith("packages/runtime-mcp/src/");
	if (!isInternalConsumer || hasStricterProductionBoundary) return;
	if (specifiers.includes("@astravia/coding-agent")) {
		findings.push(
			`${posixPath}: internal consumers must use an explicit @astravia/coding-agent subpath instead of the compatibility root`,
		);
	}
}

function checkCodingAgentToolPublicSurfaceBoundary(posixPath, text, findings) {
	const isProtectedSurface =
		posixPath === "packages/coding-agent/src/index.ts" || posixPath === "packages/coding-agent/src/public-api/rpc.ts";
	if (!isProtectedSurface) return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	for (const statement of sourceFile.statements) {
		if (!ts.isExportDeclaration(statement)) continue;
		const moduleSpecifier = ts.isStringLiteralLike(statement.moduleSpecifier)
			? statement.moduleSpecifier.text
			: undefined;
		if (
			moduleSpecifier?.includes("core/tools") ||
			moduleSpecifier === "@astravia/runtime-tools/coding" ||
			moduleSpecifier?.startsWith("@astravia/runtime-tools/coding/")
		) {
			findings.push(
				`${posixPath}: coding-agent public surfaces must not forward concrete Tool implementations (${moduleSpecifier})`,
			);
		}

		if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
		for (const element of statement.exportClause.elements) {
			const exportedName = element.name.text;
			if (RETIRED_CODING_AGENT_TOOL_EXPORTS.has(exportedName)) {
				findings.push(
					`${posixPath}: coding-agent public surfaces must not export concrete Tool symbol ${exportedName}`,
				);
			}
		}
	}
}

function workspacePackageName(specifier) {
	if (!specifier.startsWith("@astravia/") && !specifier.startsWith("@astravia-org/")) return undefined;
	return specifier.split("/").slice(0, 2).join("/");
}

function checkWorkspaceManifestImports(posixPath, specifiers, manifest, findings) {
	if (!manifest || !MANIFEST_TRUTH_PACKAGE_NAMES.has(manifest.name) || !posixPath.includes("/src/")) return;
	const declared = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);
	for (const specifier of specifiers) {
		const packageName = workspacePackageName(specifier);
		if (!packageName || packageName === manifest.name || declared.has(packageName)) continue;
		findings.push(`${posixPath}: workspace import ${packageName} is not declared by ${manifest.name}`);
	}
}

function checkRuntimeCoreImports(posixPath, specifiers, findings) {
	if (!posixPath.startsWith("packages/runtime-core/src/")) return;
	for (const specifier of specifiers) {
		if (specifier === "@astravia/coding-agent" || specifier.startsWith("@astravia/coding-agent/")) {
			findings.push(`${posixPath}: runtime-core production code must not import coding-agent (${specifier})`);
		}
	}
}

function checkAgentCoreImports(posixPath, specifiers, findings) {
	if (!posixPath.startsWith("packages/agent/src/")) return;
	for (const specifier of specifiers) {
		const importsRuntime = specifier.startsWith("@astravia/runtime-");
		const importsCodingAgent =
			specifier === "@astravia/coding-agent" || specifier.startsWith("@astravia/coding-agent/");
		if (importsRuntime || importsCodingAgent) {
			findings.push(`${posixPath}: agent-core must not import runtime or product packages (${specifier})`);
		}
	}
}

export function findDurablePackageBoundaryViolations(posixPath, text, options = {}) {
	const findings = [];
	const specifiers = collectImportSpecifiers(posixPath, text);
	checkForbiddenAppImports(posixPath, specifiers, findings);
	checkTestTreeImports(posixPath, specifiers, findings);
	checkPluginDesktopDeepImport(posixPath, specifiers, findings);
	checkDesktopCliSourceImports(posixPath, specifiers, findings);
	checkDesktopRendererMcpImports(posixPath, text, findings);
	checkPluginDesktopGlobal(posixPath, text, findings);
	checkCapabilityLayerImports(posixPath, specifiers, findings);
	checkPublicSystemSdkImports(posixPath, specifiers, findings);
	checkRawCapabilityIds(posixPath, text, findings);
	checkCapabilitySchemaDefinitions(posixPath, text, findings);
	checkGreenfieldRuntimeImports(posixPath, specifiers, findings);
	checkStorageProtocolImports(posixPath, specifiers, findings);
	checkToolsProtocolImports(posixPath, specifiers, findings);
	checkMcpProtocolImports(posixPath, specifiers, findings);
	checkRuntimeCorePlatformImports(posixPath, text, specifiers, findings);
	checkRuntimeProductSemanticBoundary(posixPath, text, findings);
	checkCodingAgentRootImports(posixPath, specifiers, findings);
	checkCodingAgentToolPublicSurfaceBoundary(posixPath, text, findings);
	checkWorkspaceManifestImports(posixPath, specifiers, options.manifest, findings);
	checkRuntimeCoreImports(posixPath, specifiers, findings);
	checkAgentCoreImports(posixPath, specifiers, findings);
	return findings;
}

export function findDurablePackageManifestBoundaryViolations(manifest) {
	const findings = [];
	if (!manifest) return findings;
	if (manifest.name === "@astravia/agent-core") {
		const productionDependencies = {
			...manifest.dependencies,
			...manifest.optionalDependencies,
			...manifest.peerDependencies,
		};
		for (const dependency of Object.keys(productionDependencies)) {
			if (dependency.startsWith("@astravia/runtime-") || dependency === "@astravia/coding-agent") {
				findings.push(`@astravia/agent-core: lower-level execution kernel must not depend on ${dependency}`);
			}
		}
	}
	return findings;
}

const roots = [
	join(repoRoot, "packages/capability-sdk"),
	join(repoRoot, "packages/capability-runtime"),
	join(repoRoot, "packages/ai"),
	join(repoRoot, "packages/agent"),
	join(repoRoot, "packages/coding-agent"),
	join(repoRoot, "packages/ecosystem-adapter"),
	join(repoRoot, "packages/runtime-core"),
	join(repoRoot, "packages/runtime-knowledge"),
	join(repoRoot, "packages/runtime-tools"),
	join(repoRoot, "packages/runtime-storage"),
	join(repoRoot, "packages/runtime-node"),
	join(repoRoot, "packages/runtime-mcp"),
	join(repoRoot, "packages/runtime-telemetry"),
	join(repoRoot, "packages/runtime-desktop"),
	join(repoRoot, "packages/action-rpc"),
	join(repoRoot, "packages/toolkit"),
	join(repoRoot, "packages/theme-sdk"),
	join(repoRoot, "packages/theme-ui"),
	join(repoRoot, "packages/markdown"),
	join(repoRoot, "packages/ui"),
	join(repoRoot, "packages/plugins"),
	join(repoRoot, "packages/themes"),
	join(repoRoot, "apps/cli-host"),
	join(repoRoot, "apps/desktop"),
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

function manifestForFile(posixPath) {
	const root = roots.find((candidate) => {
		const relativeRoot = rel(candidate);
		return posixPath === `${relativeRoot}/package.json` || posixPath.startsWith(`${relativeRoot}/`);
	});
	if (!root) return undefined;
	try {
		return JSON.parse(readText(join(root, "package.json")));
	} catch {
		return undefined;
	}
}

export function main(files = process.argv.slice(2)) {
	const findings = [];
	let scanned = 0;
	if (files.length > 0) {
		for (const file of [...new Set(files.map((value) => value.replaceAll("\\", "/")))]) {
			const absolute = join(repoRoot, file);
			if (!existsSync(absolute)) continue;
			if (file === "tsconfig.json") {
				findings.push(...findDurablePackageBoundaryViolations(file, readText(absolute)));
				scanned += 1;
				continue;
			}
			if (file.endsWith("/package.json") || file === "package.json") {
				try {
					findings.push(...findDurablePackageManifestBoundaryViolations(JSON.parse(readText(absolute))));
				} catch {
					// JSON parsing is owned by Biome/type tooling; this guard only checks valid manifests.
				}
				scanned += 1;
				continue;
			}
			if (!SOURCE_EXTENSIONS.has(extname(file))) continue;
			if (file.includes("/examples/") || file.includes("/agent/cli/")) continue;
			findings.push(
				...findDurablePackageBoundaryViolations(file, readText(absolute), { manifest: manifestForFile(file) }),
			);
			scanned += 1;
		}
	} else {
		const rootTsconfigPath = join(repoRoot, "tsconfig.json");
		findings.push(...findDurablePackageBoundaryViolations("tsconfig.json", readText(rootTsconfigPath)));
		scanned += 1;

		for (const root of roots) {
			let manifest;
			try {
				manifest = JSON.parse(readText(join(root, "package.json")));
			} catch {
				manifest = undefined;
			}
			findings.push(...findDurablePackageManifestBoundaryViolations(manifest));
			for (const file of walkFiles(root)) {
				const posixPath = rel(file);
				if (posixPath.includes("/node_modules/") || posixPath.includes("/dist/")) continue;
				// 构建期内置进插件包的第三方产物（如工作台的 agent/cli/），是打包结果不是源码
				if (posixPath.includes("/agent/cli/")) continue;
				// examples under coding-agent may intentionally wire hosts; skip demos
				if (posixPath.includes("/examples/")) continue;
				let text;
				try {
					text = readText(file);
				} catch {
					continue;
				}
				scanned += 1;
				findings.push(...findDurablePackageBoundaryViolations(posixPath, text, { manifest }));
			}
		}
	}

	if (findings.length === 0) {
		ok(`[package-boundaries] ok (${scanned} file(s) scanned${files.length > 0 ? ", selected" : ""})`);
		return 0;
	}

	for (const line of findings) {
		fail(`[package-boundaries] ${line}`);
	}
	fail(`[package-boundaries] ${findings.length} violation(s)`);
	return 1;
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
