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

import { join } from "node:path";
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
	"@vetta/coding-agent",
	"@vetta/runtime-knowledge",
	"@vetta/runtime-storage",
	"@vetta/runtime-node",
	"@vetta/runtime-tools",
	"@vetta/runtime-desktop",
	"@vetta/cli-host",
	"@vetta/desktop",
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

const RETIRED_CLI_COMPOSITION_FORWARDERS = new Set([
	"apps/cli-host/src/conversation-ownership-binding.ts",
	"apps/cli-host/src/greenfield-runtime-composition.ts",
	"apps/cli-host/src/greenfield-runtime-host-session-backend.ts",
	"apps/cli-host/src/greenfield-session-execution-runtime.ts",
	"apps/cli-host/src/greenfield-session-peripherals.ts",
	"apps/cli-host/src/greenfield-subagent-child.ts",
	"apps/cli-host/src/greenfield-subagent-runtime.ts",
	"apps/cli-host/src/greenfield-subagent-state-persistence.ts",
	"apps/cli-host/src/rpc/greenfield-conversation-path.ts",
	"apps/cli-host/src/runtime-tools-composition.ts",
]);

const RETIRED_CODING_AGENT_RUNTIME_HOST = "@vetta/coding-agent/runtime-host";

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
			node.name.text === "vetta" &&
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
	for (const packageName of ["@vetta/desktop", "@vetta/cli-host", "@vetta/site", "shadcn-admin"]) {
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

function checkPluginDesktopGlobal(posixPath, text, findings) {
	if (!isPluginPackageFile(posixPath) || posixPath.endsWith(".d.ts")) return;
	// Explicit exceptions that must touch the host Desktop API surface:
	// - plugin-workbench: trusted host management UI (install/dev-watch)
	// - security-probe: intentional audit of window.vetta bypass / trust boundary
	if (posixPath.startsWith("packages/plugins/presets/plugin-workbench/")) return;
	if (posixPath.startsWith("packages/plugins/externals/security-probe/")) return;
	if (usesDesktopPluginGlobal(posixPath, text)) {
		findings.push(`${posixPath}: plugins must use the public plugin SDK instead of window.vetta`);
	}
}

function checkCapabilityLayerImports(posixPath, specifiers, findings) {
	const isCapabilitySdk = posixPath.startsWith("packages/capability-sdk/");
	const isCapabilityRuntime = posixPath.startsWith("packages/capability-runtime/");
	if (!isCapabilitySdk && !isCapabilityRuntime) return;

	const forbiddenPrefixes = [
		"@vetta-org/plugin-sdk",
		"@vetta/action-rpc",
		"@vetta/desktop",
		"@vetta/theme-sdk",
		"@vetta/theme-ui",
	];
	if (isCapabilitySdk) forbiddenPrefixes.push("@vetta/capability-runtime");
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
		if (specifier.startsWith("@vetta/capability-sdk/internal/")) {
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
		if (specifier === "@vetta/coding-agent" || specifier.startsWith("@vetta/coding-agent/")) {
			findings.push(`${posixPath}: greenfield runtime modules must not import coding-agent (${specifier})`);
		}
	}
}

function checkStorageProtocolImports(posixPath, specifiers, findings) {
	if (!posixPath.startsWith("packages/runtime-storage/src/")) return;
	for (const specifier of specifiers) {
		if (
			specifier.startsWith("node:") ||
			specifier === "@vetta/runtime-node" ||
			specifier.startsWith("@vetta/runtime-node/") ||
			specifier === "@vetta/runtime-desktop" ||
			specifier.startsWith("@vetta/runtime-desktop/")
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
			specifier === "@vetta/runtime-node" ||
			specifier.startsWith("@vetta/runtime-node/") ||
			specifier === "@vetta/runtime-desktop" ||
			specifier.startsWith("@vetta/runtime-desktop/")
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
			specifier === "@vetta/runtime-node" ||
			specifier.startsWith("@vetta/runtime-node/") ||
			specifier === "@vetta/runtime-desktop" ||
			specifier.startsWith("@vetta/runtime-desktop/")
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
			specifier === "@vetta/runtime-node" ||
			specifier.startsWith("@vetta/runtime-node/") ||
			specifier === "@vetta/runtime-desktop" ||
			specifier.startsWith("@vetta/runtime-desktop/")
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

function checkGreenfieldLegacyStartupSymbols(posixPath, text, findings) {
	const isGreenfieldProductModule =
		posixPath.startsWith("apps/cli-host/src/rpc/") || posixPath.startsWith("packages/coding-agent/src/composition/");
	if (!isGreenfieldProductModule) return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set(["createLegacyAgentBootstrap", "runLegacyAgentWithBootstrap"]);
	const usedSymbols = new Set();
	const usedPolicyLiterals = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			usedSymbols.add(node.text);
		}
		if (ts.isStringLiteralLike(node) && node.text === "legacy-extension") {
			usedPolicyLiterals.add(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	for (const symbol of usedSymbols) {
		findings.push(`${posixPath}: greenfield product modules must not use legacy startup symbol ${symbol}`);
	}
	for (const literal of usedPolicyLiterals) {
		findings.push(`${posixPath}: greenfield product modules must report compatibility facts instead of ${literal}`);
	}
}

function checkActiveSessionTransitionBoundary(posixPath, text, specifiers, findings) {
	if (posixPath !== "packages/runtime-core/src/runtime-host/active-session-host.ts") return;
	for (const specifier of specifiers) {
		if (specifier.startsWith("node:")) {
			findings.push(`${posixPath}: active-session transactions must use host ports instead of ${specifier}`);
		}
		if (specifier.includes("core/session-manager") || specifier.includes("legacy-session-import-normalizer")) {
			findings.push(`${posixPath}: active-session transactions must delegate Legacy session seed construction`);
		}
		if (specifier === "@vetta/coding-agent" || specifier.startsWith("@vetta/coding-agent/")) {
			findings.push(`${posixPath}: active-session transactions must not import Coding Agent products`);
		}
		if (specifier.includes("core/extensions")) {
			findings.push(`${posixPath}: active-session transactions must use neutral session action ports`);
		}
	}
	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"ExtensionCommandContextActions",
		"CodingAgentRuntimeComposition",
		"CodingAgentSessionTransitionRuntimePort",
		"SessionManager",
		"Buffer",
		"process",
		"migrateLegacySessionToV2",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(`${posixPath}: active-session transactions must not use ${node.text}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkBranchNavigationBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/host/session-history/branch-navigation-host.ts") return;
	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const visit = (node) => {
		if (ts.isIdentifier(node) && node.text === "ExtensionCommandContextActions") {
			findings.push(`${posixPath}: branch navigation must expose a neutral options contract`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkKnowledgeProcessingBoundary(posixPath, text, specifiers, findings) {
	const processingPath = "packages/coding-agent/src/composition/knowledge-processing-session.ts";
	const contractPath = "packages/coding-agent/src/composition/knowledge-processing-contract.ts";
	if (posixPath === processingPath) {
		for (const specifier of specifiers) {
			if (specifier.includes("legacy-knowledge-processing-session")) {
				findings.push(`${posixPath}: Knowledge Processing must depend on the neutral contract`);
			}
		}
		return;
	}
	if (posixPath !== contractPath) return;

	const forbiddenImportFragments = [
		"agent-session",
		"runtime-composition",
		"legacy-knowledge-processing-session",
		"session-manager",
		"/sdk",
	];
	for (const specifier of specifiers) {
		if (
			specifier === "@vetta/runtime-core" ||
			specifier.startsWith("@vetta/runtime-core/") ||
			forbiddenImportFragments.some((fragment) => specifier.includes(fragment))
		) {
			findings.push(`${posixPath}: Knowledge Processing contract must not depend on a backend implementation`);
		}
	}
	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"AgentSession",
		"CodingAgentRuntimeComposition",
		"SessionManager",
		"createAgentSession",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(`${posixPath}: Knowledge Processing contract must not use ${node.text}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentSubagentAssemblyBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"CodingAgentSubagentProfile",
		"CodingAgentSubagentRuntime",
		"SubagentChildHandle",
		"SubagentLifecycle",
		"SubagentSnapshot",
		"SubagentSpawnRequest",
		"SubagentTypeDefinition",
		"createCodingAgentSubagentChildHandle",
		"runSubagentStart",
		"runSubagentStop",
		"validateRecoveredSubagentTranscript",
	]);
	const forbiddenLiterals = new Set([".subagents", "subagent-notification", "subagents_update"]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(`${posixPath}: Coding Agent Composition Root must delegate Subagent assembly (${node.text})`);
		}
		if (ts.isStringLiteralLike(node) && forbiddenLiterals.has(node.text)) {
			findings.push(`${posixPath}: Coding Agent Composition Root must not own Subagent policy (${node.text})`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentTurnCapabilityAssemblyBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"CodingAgentContinuationOrchestrator",
		"CodingAgentModelCallMessageFinalizer",
		"CodingAgentModelCallFrameComposer",
		"CodingAgentPluginRunOrchestrator",
		"CodingAgentPluginToolRuntime",
		"CodingAgentPromptRequestAdapter",
		"CodingAgentPromptRuntime",
		"CodingAgentStopHookContinuationSource",
		"CodingAgentTodoContinuationSource",
		"RuntimeCapabilityComposition",
		"createCodingAgentInvokeSkillFeature",
		"createCodingAgentPromptResourceResolver",
		"createCodingAgentPromptRuntime",
		"joinPromptAddons",
		"previewSystemPrompt",
		"toPluginToolActivation",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must delegate Turn Capability assembly (${node.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentDomainAdapterBoundary(posixPath, specifiers, findings) {
	const domainRoots = [
		"packages/coding-agent/src/extensions/",
		"packages/coding-agent/src/features/",
		"packages/coding-agent/src/memory/",
		"packages/coding-agent/src/mcp/",
		"packages/coding-agent/src/model-context/",
		"packages/coding-agent/src/plugins/",
		"packages/coding-agent/src/resources/",
		"packages/coding-agent/src/sessions/",
	];
	if (!domainRoots.some((root) => posixPath.startsWith(root))) return;
	for (const specifier of specifiers) {
		if (!specifier.includes("adapters/")) continue;
		findings.push(`${posixPath}: Coding Agent domain must depend on contracts instead of Adapters (${specifier})`);
	}
}

function checkRuntimePromptContractIdentity(posixPath, text, findings) {
	if (!posixPath.startsWith("packages/runtime-core/src/")) return;

	const retiredSymbols = new Set([
		"GreenfieldPromptPreparationContext",
		"GreenfieldPreparedPrompt",
		"GreenfieldPromptInterceptionResult",
		"GreenfieldHandledPromptResult",
		"GreenfieldPromptResult",
		"GreenfieldPromptAdapter",
	]);
	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const foundSymbols = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node) && retiredSymbols.has(node.text)) {
			foundSymbols.add(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	for (const symbol of foundSymbols) {
		findings.push(`${posixPath}: Runtime Prompt contract must use its stable identity (${symbol})`);
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

function checkCodingAgentSessionResourceLifecycleBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME",
		"CodingAgentBackgroundWorkController",
		"CodingAgentSessionRuntimeResources",
		"createSessionPeripherals",
		"hookSessionController",
		"hookSessionEnded",
		"isCodingAgentAskUserQuestionEnabled",
		"onConversationContinued",
		"readActiveToolNames",
		"sessionCleanup",
		"stateSource",
		"withAgentMode",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must delegate Session Resource Lifecycle assembly (${node.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentCompositionResourceRegistryBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"InMemoryCodingAgentSessionMarkerIndex",
		"InMemoryCodingAgentSessionValueIndex",
		"RetryableCleanup",
		"compositionCleanup",
		"contextRuntimes",
		"hookSessionDisposers",
		"memoryRuntimes",
		"ownershipBindings",
		"prepareCompositionCleanup",
		"todoRuntimes",
		"turnCapabilityAssemblies",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must delegate resource registry and shutdown (${node.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentMcpSessionCoordinatorBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"McpRuntimeToolSynchronizer",
		"createMcpDeferredToolController",
		"createMcpRuntimeToolSynchronizer",
		"mergeMcpSnapshots",
		"mergeMcpToolViews",
		"refreshAndMergeMcpViews",
	]);
	const forbiddenLiterals = new Set(["mcp.reload.start", "mcp.reload.end"]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must delegate MCP Session coordination (${node.text})`,
			);
		}
		if (ts.isStringLiteralLike(node) && forbiddenLiterals.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must not own MCP refresh observation policy (${node.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentSessionInitializationTransactionBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"CodingAgentGreenfieldContextRuntime",
		"CodingAgentMemoryRolloverOrchestrator",
		"CodingAgentTodoRuntime",
		"CodingAgentSessionConfigurationState",
		"CodingAgentSessionExecutionRuntime",
		"InitializationRollbackScope",
		"createEcosystemHookRuntime",
		"createForkContextFeature",
		"createCodingAgentSessionResourceLifecycle",
		"createCodingAgentSubagentSessionAssembly",
		"createCodingAgentTurnCapabilitySessionAssembly",
		"createSessionPluginRuntime",
	]);
	const forbiddenRollbackIds = new Set([
		"capability-composition",
		"configuration-state-binding",
		"context-runtime",
		"conversation-context-overlay",
		"conversation-ownership",
		"execution-runtime",
		"hook-session",
		"mcp-controller-binding",
		"memory-runtime",
		"plugin-mcp-runtime",
		"resource-context-binding",
		"session-bindings",
		"subagent-runtime",
		"todo-runtime",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must delegate Session initialization (${node.text})`,
			);
		}
		if (ts.isStringLiteralLike(node) && forbiddenRollbackIds.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must not own Session initialization rollback (${node.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentSessionInitializationProfileBoundary(posixPath, text, findings) {
	const compositionRootPath = "packages/coding-agent/src/composition/runtime-composition.ts";
	const transactionPath = "packages/coding-agent/src/composition/session-initialization/transaction.ts";
	if (posixPath !== compositionRootPath && posixPath !== transactionPath) return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const visit = (node) => {
		if (
			posixPath === compositionRootPath &&
			ts.isPropertyAssignment(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "composition"
		) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must project Session initialization options through a profile`,
			);
		}
		if (
			posixPath === transactionPath &&
			ts.isIdentifier(node) &&
			(node.text === "CodingAgentRuntimeCompositionOptions" || node.text === "composition")
		) {
			findings.push(
				`${posixPath}: Session initialization transaction must depend on its narrow profile (${node.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentSessionInitializationStageBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/session-initialization/transaction.ts") {
		return;
	}

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenConstructors = new Set([
		"CodingAgentGreenfieldContextRuntime",
		"CodingAgentSessionMemoryController",
		"CodingAgentMemoryRolloverOrchestrator",
		"CodingAgentTodoRuntime",
		"GreenfieldRuntimeModel",
		"CodingAgentSessionConfigurationState",
		"CodingAgentSessionExecutionRuntime",
	]);
	const forbiddenFactories = new Set([
		"createCodingAgentSpecializedToolRegistrations",
		"createCodingAgentTodoRuntimeToolRegistration",
		"createEcosystemHookRuntime",
		"createForkContextFeature",
		"createCodingAgentSubagentSessionAssembly",
		"createSessionPluginRuntime",
	]);
	const visit = (node) => {
		if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			forbiddenConstructors.has(node.expression.text)
		) {
			findings.push(
				`${posixPath}: Session initialization transaction must delegate staged runtime construction (${node.expression.text})`,
			);
		}
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			forbiddenFactories.has(node.expression.text)
		) {
			findings.push(
				`${posixPath}: Session initialization transaction must delegate staged runtime policy (${node.expression.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentRuntimeToolSurfaceBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"CODING_AGENT_MODEL_TOOL_ORDER",
		"CODING_TOOL_SCOPES",
		"adaptCodingAgentToolRegistration",
		"createCodingToolsRuntimeComposition",
		"createCodingAgentMcpSessionCoordinator",
		"createKbFilterByTagsTool",
		"createKbListTagsTool",
		"isCodingAgentKnowledgeToolEnabled",
		"isKnowledgeToolEnabled",
		"resolveCodingAgentToolActivation",
		"resolveTurnToolActivation",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(`${posixPath}: Coding Agent Composition Root must delegate Runtime Tool Surface (${node.text})`);
		}
		if (ts.isStringLiteralLike(node) && node.text === "knowledge_mode_instruction") {
			findings.push(`${posixPath}: Coding Agent Composition Root must not own Knowledge Tool activation policy`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentRuntimeToolPortBoundary(posixPath, text, findings) {
	const contractPath = "packages/coding-agent/src/composition/contracts/runtime-composition-result.ts";
	const compositionPath = "packages/coding-agent/src/composition/tool-surface/runtime-tools-composition.ts";
	if (posixPath !== contractPath && posixPath !== compositionPath) return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	if (posixPath === contractPath) {
		const forbiddenSymbols = new Set([
			"CodingToolsRuntimeComposition",
			"FeatureCompiler",
			"InMemoryCodingToolRegistry",
		]);
		const visit = (node) => {
			if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
				findings.push(
					`${posixPath}: Greenfield Runtime Tool access must depend on CodingToolRegistry (${node.text})`,
				);
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
		return;
	}

	for (const statement of sourceFile.statements) {
		if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== "CodingToolsRuntimeComposition") continue;
		for (const member of statement.members) {
			if (
				ts.isPropertySignature(member) &&
				member.name !== undefined &&
				ts.isIdentifier(member.name) &&
				member.name.text === "registry" &&
				member.type?.getText(sourceFile) !== "CodingToolRegistry"
			) {
				findings.push(`${posixPath}: Coding Tools composition must expose its Registry through CodingToolRegistry`);
			}
		}
	}
}

function checkCodingAgentToolPolicyOwnershipBoundary(posixPath, text, findings) {
	const isAdapter = posixPath.startsWith("packages/coding-agent/src/adapters/");
	const isComposition = posixPath.startsWith("packages/coding-agent/src/composition/");
	if (!isAdapter && !isComposition) return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const compositionPolicyDeclarations = new Set([
		"CodingAgentToolAvailability",
		"isCodingAgentKnowledgeToolEnabled",
		"resolveCodingAgentToolActivation",
	]);
	const adapterPolicyDeclarations = new Set([
		"CODING_AGENT_MODEL_TOOL_ORDER",
		"CODING_AGENT_SUBAGENT_MODEL_TOOL_ORDER_STEP",
	]);
	const visit = (node) => {
		if (
			isAdapter &&
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			adapterPolicyDeclarations.has(node.name.text)
		) {
			findings.push(`${posixPath}: Coding Agent Adapter must not own Tool policy (${node.name.text})`);
		}
		if (
			isComposition &&
			((ts.isFunctionDeclaration(node) && node.name) ||
				(ts.isInterfaceDeclaration(node) && node.name) ||
				(ts.isTypeAliasDeclaration(node) && node.name)) &&
			compositionPolicyDeclarations.has(node.name.text)
		) {
			findings.push(`${posixPath}: Coding Agent Composition must not declare Tool policy (${node.name.text})`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentChildCompositionPolicyBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"_createPluginMcpRuntime",
		"_extensionTools",
		"_mcpSource",
		"childComposition",
		"childCompositionOptions",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must delegate Child Composition policy (${node.text})`,
			);
		}
		if (
			ts.isPropertyAssignment(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "enableSubagents" &&
			node.initializer.kind === ts.SyntaxKind.FalseKeyword
		) {
			findings.push(`${posixPath}: Coding Agent Composition Root must not own recursive Child isolation policy`);
		}
		if (
			ts.isPropertyAccessExpression(node) &&
			(node.name.text === "create" || node.name.text === "resume") &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "backend"
		) {
			findings.push(`${posixPath}: Coding Agent Composition Root must delegate Child Composition projection`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkGreenfieldRuntimeHostControlSurfaceBoundary(posixPath, text, findings) {
	if (posixPath !== "packages/coding-agent/src/composition/runtime-composition.ts") return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const forbiddenSymbols = new Set([
		"appendSessionContext",
		"bindExtensionRunner",
		"clearSessionExecutionContext",
		"deliverSessionContext",
		"executionRuntimes",
		"extensionEventBridges",
		"flushMemory",
		"hookSessionControllers",
		"memoryControllers",
		"preserveSessionExecutionContext",
		"quiesceSessionBackgroundCommands",
		"refreshExtensionTools",
		"resourceContexts",
		"sessionHooks",
	]);
	const visit = (node) => {
		if (ts.isIdentifier(node) && forbiddenSymbols.has(node.text)) {
			findings.push(
				`${posixPath}: Coding Agent Composition Root must delegate Runtime Host Controls (${node.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkCodingAgentSessionHostOwnershipBoundary(posixPath, text, findings) {
	if (!posixPath.startsWith("packages/coding-agent/src/composition/")) return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const hostOwnedDeclarations = new Set([
		"CodingAgentBackgroundWorkController",
		"CodingAgentPluginReconfiguration",
		"CodingAgentSessionConfigurationState",
		"CodingAgentSessionExecutionRuntime",
		"CodingAgentSubagentWorkRuntime",
	]);
	const visit = (node) => {
		if (
			(ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
			node.name &&
			hostOwnedDeclarations.has(node.name.text)
		) {
			findings.push(
				`${posixPath}: Coding Agent Composition must not declare Session Host capability (${node.name.text})`,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function checkRetiredAutomaticLegacyFallback(posixPath, text, findings) {
	const isRuntimeProductionSource =
		(posixPath.startsWith("apps/cli-host/src/") || posixPath.startsWith("packages/coding-agent/src/")) &&
		!posixPath.endsWith(".d.ts") &&
		!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(posixPath);
	if (!isRuntimeProductionSource) return;

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const retiredFallbacks = new Set();
	const visit = (node) => {
		if (
			ts.isStringLiteralLike(node) &&
			(node.text === "legacy-extension" || node.text === "legacy-session" || node.text === "session-migration-gap")
		) {
			retiredFallbacks.add(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	for (const fallback of retiredFallbacks) {
		findings.push(
			`${posixPath}: automatic ${fallback} fallback is retired; report an explicit compatibility failure instead`,
		);
	}
}

function checkRetiredCompositionBoundaries(posixPath, text, specifiers, findings) {
	if (posixPath.startsWith("packages/runtime-composition/")) {
		findings.push(`${posixPath}: retired runtime-composition package must stay deleted`);
	}
	if (text.includes("@vetta/runtime-composition")) {
		findings.push(`${posixPath}: retired @vetta/runtime-composition reference must stay deleted`);
	}
	if (RETIRED_CLI_COMPOSITION_FORWARDERS.has(posixPath)) {
		findings.push(`${posixPath}: retired CLI composition forwarding module must stay deleted`);
	}
	if (posixPath === "apps/cli-host/src/index.ts" && specifiers.includes("@vetta/coding-agent/composition")) {
		findings.push(`${posixPath}: CLI public API must not re-export Coding Agent composition`);
	}
	if (
		posixPath.startsWith("apps/desktop/src/") &&
		specifiers.includes("@vetta/cli-host") &&
		/\b(?:CodingAgentGreenfieldActiveSessionHost|CodingToolsRuntimeComposition|GreenfieldCliSessionOptions|CodingAgentRuntimeComposition(?:Options)?|GreenfieldRuntimeHostSessionBackend|resolveGreenfieldSessionIdFromPath)\b/.test(
			text,
		)
	) {
		findings.push(`${posixPath}: Desktop must import Coding Agent composition contracts from their owner`);
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
	if (specifiers.includes("@vetta/coding-agent")) {
		findings.push(
			`${posixPath}: internal consumers must use an explicit @vetta/coding-agent subpath instead of the compatibility root`,
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
			moduleSpecifier === "@vetta/runtime-tools/coding" ||
			moduleSpecifier?.startsWith("@vetta/runtime-tools/coding/")
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

function checkRetiredCodingAgentKnowledgeSurface(posixPath, specifiers, findings) {
	if (posixPath.startsWith("packages/coding-agent/src/core/knowledge/")) {
		findings.push(`${posixPath}: retired Coding Agent Knowledge implementation must stay deleted`);
	}
	for (const specifier of specifiers) {
		if (specifier !== "@vetta/coding-agent/knowledge" && !specifier.includes("core/knowledge")) continue;
		findings.push(`${posixPath}: retired Coding Agent Knowledge surface import (${specifier})`);
	}
}

const RETIRED_CODING_AGENT_MODEL_CONTEXT_FILES = new Set([
	"packages/coding-agent/src/core/messages.ts",
	"packages/coding-agent/src/core/subconscious.ts",
	"packages/coding-agent/src/core/system-prompt.ts",
]);

function checkRetiredCodingAgentModelContextSurface(posixPath, specifiers, findings) {
	if (RETIRED_CODING_AGENT_MODEL_CONTEXT_FILES.has(posixPath)) {
		findings.push(`${posixPath}: retired Coding Agent model-context implementation must stay deleted`);
	}
	for (const specifier of specifiers) {
		if (!/core\/(?:messages|subconscious|system-prompt)(?:\.js)?$/.test(specifier)) continue;
		findings.push(`${posixPath}: retired Coding Agent model-context import (${specifier})`);
	}
}

function checkCodingAgentCompactionBoundary(posixPath, specifiers, findings) {
	if (posixPath.startsWith("packages/coding-agent/src/core/compaction/")) {
		findings.push(`${posixPath}: retired Coding Agent core Compaction implementation must stay deleted`);
	}
	for (const specifier of specifiers) {
		if (specifier.includes("core/compaction")) {
			findings.push(`${posixPath}: retired Coding Agent core Compaction import (${specifier})`);
		}
	}

	if (!posixPath.startsWith("packages/coding-agent/src/compaction/")) return;
	const isCompactionRuntime = posixPath.startsWith("packages/coding-agent/src/compaction/runtime/");
	for (const specifier of specifiers) {
		const dependsOnSessionImplementation = specifier.includes("/core/") || specifier.includes("/adapters/");
		const dependsOnRuntimeStorage =
			specifier === "@vetta/runtime-core" ||
			specifier.startsWith("@vetta/runtime-core/") ||
			specifier === "@vetta/runtime-storage" ||
			specifier.startsWith("@vetta/runtime-storage/");
		if (dependsOnSessionImplementation || (dependsOnRuntimeStorage && !isCompactionRuntime)) {
			findings.push(
				`${posixPath}: Compaction policy must not depend on Session implementations; ` +
					`only compaction/runtime may consume Runtime Core contracts (${specifier})`,
			);
		}
	}
}

function checkCodingAgentLegacyBoundaries(posixPath, text, specifiers, findings) {
	const isProductionSource = posixPath.includes("/src/") && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(posixPath);
	if (!isProductionSource) return;
	const historicalSessionPublicSubpath = "@vetta/coding-agent/historical-sessions";
	const historicalSessionConsumers = new Set([
		"apps/cli-host/src/coding-agent-bootstrap.ts",
		"apps/cli-host/src/rpc/cli-session-format-compatibility.ts",
		"apps/cli-host/src/rpc/runtime-host/runtime-host-contract.ts",
		"apps/cli-host/src/rpc/runtime-host/runtime-host.ts",
		"apps/cli-host/src/session-compatibility-error.ts",
		"apps/cli-host/src/html-export-runtime.ts",
		"packages/runtime-desktop/src/historical-session-format.ts",
		"packages/runtime-desktop/src/historical-session-import-backend.ts",
	]);

	for (const specifier of specifiers) {
		if (specifier.startsWith("@vetta/coding-agent/legacy/")) {
			findings.push(`${posixPath}: production Legacy subpath import is outside the compatibility allowlist`);
		}
		if (specifier === historicalSessionPublicSubpath && !historicalSessionConsumers.has(posixPath)) {
			findings.push(`${posixPath}: historical Session public surface is outside the host compatibility allowlist`);
		}
	}

	const sourceFile = ts.createSourceFile(posixPath, text, ts.ScriptTarget.Latest, true, scriptKind(posixPath));
	const usedSymbols = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node)) usedSymbols.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	if (posixPath.startsWith("apps/cli-host/src/") && !posixPath.startsWith("apps/cli-host/src/rpc/")) {
		for (const symbol of ["runLegacyAgent", "runLegacyAgentWithBootstrap"]) {
			if (usedSymbols.has(symbol)) {
				findings.push(`${posixPath}: Legacy startup symbol ${symbol} is outside the execution gateway`);
			}
		}
	}

	const isLegacyFormatModule = posixPath.startsWith("packages/coding-agent/src/sessions/legacy/");
	if (isLegacyFormatModule) {
		const forbiddenImportFragments = ["agent-session", "/sdk", "legacy-session-backend"];
		for (const specifier of specifiers) {
			if (forbiddenImportFragments.some((fragment) => specifier.includes(fragment))) {
				findings.push(`${posixPath}: Legacy session-format modules must not import execution code (${specifier})`);
			}
		}
		for (const symbol of ["AgentSession", "createAgentSession", "LegacyCodingAgentSessionBackend", "ModelRegistry"]) {
			if (usedSymbols.has(symbol)) {
				findings.push(`${posixPath}: Legacy session-format modules must not use execution symbol ${symbol}`);
			}
		}
	}
	const historicalRuntimeHostSurfaces = new Set([
		"packages/coding-agent/src/adapters/runtime-core/index.ts",
		"packages/coding-agent/src/adapters/runtime-core/greenfield.ts",
	]);
	const historicalRuntimeHostSymbols = new Set([
		"acquireLegacySessionFormatLease",
		"CODING_AGENT_LEGACY_AGENT_MESSAGE_CONTEXT_TYPE",
		"LegacyRuntimeSessionCatalog",
		"LegacyRuntimeSessionFileHistoryReader",
		"LegacySessionFormatLeaseResult",
		"normalizeCodingAgentLegacySessionEntry",
		"restoreCodingAgentLegacyAgentMessageEntry",
		"CodingAgentLegacySessionIncompatibilityCode",
		"CodingAgentLegacySessionMigration",
		"CodingAgentLegacySessionMigrationIncompatible",
		"CodingAgentLegacySessionMigrationSuccess",
		"migrateCodingAgentLegacySession",
	]);
	if (historicalRuntimeHostSurfaces.has(posixPath)) {
		for (const symbol of usedSymbols) {
			if (historicalRuntimeHostSymbols.has(symbol)) {
				findings.push(`${posixPath}: Runtime Host must not expose historical Session symbol ${symbol}`);
			}
		}
	}
	if (isLegacyFormatModule) return;

	const historicalSessionFacade = "packages/coding-agent/src/public-api/historical-sessions.ts";
	const protectedSymbols = new Set([
		"createLegacyRuntimeHostOptions",
		"LegacyCodingAgentSessionBackend",
		"LegacyRuntimeSessionCatalog",
		"LegacyRuntimeSessionFileHistoryReader",
		"LegacyRuntimeSharedModelController",
	]);
	for (const symbol of usedSymbols) {
		if (!protectedSymbols.has(symbol)) continue;
		const isFacadeImplementation =
			posixPath === historicalSessionFacade &&
			(symbol === "LegacyRuntimeSessionCatalog" || symbol === "LegacyRuntimeSessionFileHistoryReader");
		if (isFacadeImplementation) continue;
		findings.push(`${posixPath}: Legacy Runtime adapter ${symbol} is outside the compatibility allowlist`);
	}
}

function workspacePackageName(specifier) {
	if (!specifier.startsWith("@vetta/") && !specifier.startsWith("@vetta-org/")) return undefined;
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
		if (specifier === "@vetta/coding-agent" || specifier.startsWith("@vetta/coding-agent/")) {
			findings.push(`${posixPath}: runtime-core production code must not import coding-agent (${specifier})`);
		}
	}
}

function checkAgentCoreImports(posixPath, specifiers, findings) {
	if (!posixPath.startsWith("packages/agent/src/")) return;
	for (const specifier of specifiers) {
		const importsRuntime = specifier.startsWith("@vetta/runtime-");
		const importsCodingAgent = specifier === "@vetta/coding-agent" || specifier.startsWith("@vetta/coding-agent/");
		if (importsRuntime || importsCodingAgent) {
			findings.push(`${posixPath}: agent-core must not import runtime or product packages (${specifier})`);
		}
	}
}

function checkRetiredCodingAgentRuntimeHost(posixPath, text, specifiers, findings) {
	const retiredImports = specifiers.filter(
		(specifier) =>
			specifier === RETIRED_CODING_AGENT_RUNTIME_HOST ||
			specifier.startsWith(`${RETIRED_CODING_AGENT_RUNTIME_HOST}/`),
	);
	if (retiredImports.length > 0 && findings.length === 0) {
		findings.push(`${posixPath}: retired Coding Agent Runtime Host import (${retiredImports[0]})`);
	}

	const isResolutionConfig =
		posixPath === "tsconfig.json" || posixPath.endsWith("/tsconfig.json") || posixPath.endsWith("/vitest.config.ts");
	if (isResolutionConfig && text.includes(RETIRED_CODING_AGENT_RUNTIME_HOST)) {
		findings.push(`${posixPath}: retired Coding Agent Runtime Host resolution alias`);
	}
}

export function findPackageBoundaryViolations(posixPath, text, options = {}) {
	const findings = [];
	const specifiers = collectImportSpecifiers(posixPath, text);
	checkForbiddenAppImports(posixPath, specifiers, findings);
	checkTestTreeImports(posixPath, specifiers, findings);
	checkPluginDesktopDeepImport(posixPath, specifiers, findings);
	checkDesktopCliSourceImports(posixPath, specifiers, findings);
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
	checkGreenfieldLegacyStartupSymbols(posixPath, text, findings);
	checkActiveSessionTransitionBoundary(posixPath, text, specifiers, findings);
	checkBranchNavigationBoundary(posixPath, text, findings);
	checkKnowledgeProcessingBoundary(posixPath, text, specifiers, findings);
	checkCodingAgentSubagentAssemblyBoundary(posixPath, text, findings);
	checkCodingAgentTurnCapabilityAssemblyBoundary(posixPath, text, findings);
	checkCodingAgentSessionResourceLifecycleBoundary(posixPath, text, findings);
	checkCodingAgentCompositionResourceRegistryBoundary(posixPath, text, findings);
	checkCodingAgentMcpSessionCoordinatorBoundary(posixPath, text, findings);
	checkCodingAgentSessionInitializationTransactionBoundary(posixPath, text, findings);
	checkCodingAgentSessionInitializationProfileBoundary(posixPath, text, findings);
	checkCodingAgentSessionInitializationStageBoundary(posixPath, text, findings);
	checkCodingAgentRuntimeToolSurfaceBoundary(posixPath, text, findings);
	checkCodingAgentRuntimeToolPortBoundary(posixPath, text, findings);
	checkCodingAgentToolPolicyOwnershipBoundary(posixPath, text, findings);
	checkCodingAgentDomainAdapterBoundary(posixPath, specifiers, findings);
	checkRuntimePromptContractIdentity(posixPath, text, findings);
	checkRuntimeProductSemanticBoundary(posixPath, text, findings);
	checkCodingAgentChildCompositionPolicyBoundary(posixPath, text, findings);
	checkGreenfieldRuntimeHostControlSurfaceBoundary(posixPath, text, findings);
	checkCodingAgentSessionHostOwnershipBoundary(posixPath, text, findings);
	checkRetiredAutomaticLegacyFallback(posixPath, text, findings);
	checkRetiredCompositionBoundaries(posixPath, text, specifiers, findings);
	checkCodingAgentRootImports(posixPath, specifiers, findings);
	checkCodingAgentToolPublicSurfaceBoundary(posixPath, text, findings);
	checkRetiredCodingAgentKnowledgeSurface(posixPath, specifiers, findings);
	checkRetiredCodingAgentModelContextSurface(posixPath, specifiers, findings);
	checkCodingAgentCompactionBoundary(posixPath, specifiers, findings);
	checkCodingAgentLegacyBoundaries(posixPath, text, specifiers, findings);
	checkWorkspaceManifestImports(posixPath, specifiers, options.manifest, findings);
	checkRuntimeCoreImports(posixPath, specifiers, findings);
	checkAgentCoreImports(posixPath, specifiers, findings);
	checkRetiredCodingAgentRuntimeHost(posixPath, text, specifiers, findings);
	return findings;
}

export function findPackageManifestBoundaryViolations(manifest) {
	const findings = [];
	if (!manifest) return findings;
	if (manifest.name === "@vetta/runtime-composition") {
		findings.push("packages/runtime-composition/package.json: retired package must stay deleted");
	}
	const dependencyGroups = [
		manifest.dependencies,
		manifest.devDependencies,
		manifest.optionalDependencies,
		manifest.peerDependencies,
	];
	if (dependencyGroups.some((dependencies) => Object.hasOwn(dependencies ?? {}, "@vetta/runtime-composition"))) {
		findings.push(`${manifest.name ?? "workspace package"}: retired @vetta/runtime-composition dependency`);
	}
	if (manifest.name === "@vetta/agent-core") {
		const productionDependencies = {
			...manifest.dependencies,
			...manifest.optionalDependencies,
			...manifest.peerDependencies,
		};
		for (const dependency of Object.keys(productionDependencies)) {
			if (dependency.startsWith("@vetta/runtime-") || dependency === "@vetta/coding-agent") {
				findings.push(`@vetta/agent-core: lower-level execution kernel must not depend on ${dependency}`);
			}
		}
	}
	if (manifest.name !== "@vetta/coding-agent") return findings;
	const exports = manifest.exports ?? {};
	if (Object.hasOwn(exports, "./knowledge")) {
		findings.push("packages/coding-agent/package.json: retired ./knowledge export must stay deleted");
	}
	for (const key of ["./core/messages.js", "./core/subconscious.js", "./core/system-prompt.js"]) {
		if (Object.hasOwn(exports, key)) {
			findings.push(`packages/coding-agent/package.json: retired ${key} export must stay deleted`);
		}
	}
	for (const key of Object.keys(exports)) {
		if (key !== "./runtime-host" && !key.startsWith("./runtime-host/")) continue;
		findings.push(`packages/coding-agent/package.json: retired ${key} export must stay deleted`);
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

export function main() {
	const findings = [];
	let scanned = 0;
	const rootTsconfigPath = join(repoRoot, "tsconfig.json");
	findings.push(...findPackageBoundaryViolations("tsconfig.json", readText(rootTsconfigPath)));
	scanned += 1;

	for (const root of roots) {
		let manifest;
		try {
			manifest = JSON.parse(readText(join(root, "package.json")));
		} catch {
			manifest = undefined;
		}
		findings.push(...findPackageManifestBoundaryViolations(manifest));
		for (const file of walkFiles(root)) {
			const posixPath = rel(file);
			if (posixPath.includes("/node_modules/") || posixPath.includes("/dist/")) continue;
			// examples under coding-agent may intentionally wire hosts; skip demos
			if (posixPath.includes("/examples/")) continue;
			let text;
			try {
				text = readText(file);
			} catch {
				continue;
			}
			scanned += 1;
			findings.push(...findPackageBoundaryViolations(posixPath, text, { manifest }));
		}
	}

	if (findings.length === 0) {
		ok(`[package-boundaries] ok (${scanned} file(s) scanned)`);
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
