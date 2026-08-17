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
const RETIRED_LAYER_TERM = String.fromCharCode(112, 114, 111, 100, 117, 99, 116);
const RETIRED_LAYER_TERM_PATTERN = new RegExp(
	`\\b${RETIRED_LAYER_TERM}\\b|\\b${RETIRED_LAYER_TERM}[A-Z]|\\b${RETIRED_LAYER_TERM[0].toUpperCase()}${RETIRED_LAYER_TERM.slice(1)}[A-Z]|\\b${RETIRED_LAYER_TERM}[-_]`,
);

const DOMAIN_ROOTS = Object.freeze([
	`${SOURCE_ROOT}/extensions/`,
	`${SOURCE_ROOT}/features/`,
	`${SOURCE_ROOT}/memory/`,
	`${SOURCE_ROOT}/mcp/`,
	`${SOURCE_ROOT}/model-context/`,
	`${SOURCE_ROOT}/plugins/`,
	`${SOURCE_ROOT}/resources/`,
	`${SOURCE_ROOT}/sessions/`,
]);

const COMPOSITION_PUBLIC_SOURCE_ROOTS = Object.freeze([
	`${SOURCE_ROOT}/composition/contracts/`,
	`${SOURCE_ROOT}/composition/session-host/`,
	`${SOURCE_ROOT}/host/runtime-host/`,
	`${SOURCE_ROOT}/sessions/setup/`,
	`${SOURCE_ROOT}/tool-results/`,
]);
const COMPOSITION_PUBLIC_EXTERNAL_SOURCES = new Set(["@vetta/runtime-storage/conversation"]);
const PLATFORM_PERSISTENCE_COMPOSITION_ROOTS = Object.freeze([
	{
		path: "packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts",
		factory: "createFileConversationPersistence",
	},
	{
		path: "packages/runtime-desktop/src/backend-pool.ts",
		factory: "createFileConversationPersistence",
	},
	{
		path: "packages/desktop-app/src/main/knowledge/processing-session-factory.ts",
		factory: "createFileConversationPersistence",
	},
]);
const TOOL_ENVIRONMENT_COMPOSITION_ROOTS = Object.freeze([
	"packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts",
	"packages/runtime-desktop/src/backend-pool.ts",
	"packages/desktop-app/src/main/knowledge/processing-session-factory.ts",
	`${SOURCE_ROOT}/host/sdk-session/session-host.ts`,
]);
const TOOL_RESULT_POLICY_COMPOSITION_ROOTS = Object.freeze([
	"packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts",
	"packages/runtime-desktop/src/backend-pool.ts",
	"packages/desktop-app/src/main/knowledge/processing-session-factory.ts",
	`${SOURCE_ROOT}/host/sdk-session/session-host.ts`,
]);
const KNOWLEDGE_RUNTIME_COMPOSITION_ROOTS = Object.freeze([
	"packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts",
	"packages/desktop-app/src/main/agent-runtime/composition.ts",
	"packages/desktop-app/src/main/knowledge/processing-session-factory.ts",
	`${SOURCE_ROOT}/host/sdk-session/session-host.ts`,
]);
const MEMORY_RUNTIME_COMPOSITION_ROOTS = Object.freeze([
	"packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts",
	"packages/desktop-app/src/main/agent-runtime/composition.ts",
	`${SOURCE_ROOT}/host/sdk-session/session-host.ts`,
]);
const RPC_HOST_COMPOSITION_ROOTS = Object.freeze(["packages/cli-app/src/rpc/runtime-host/runtime-host.ts"]);

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
	checkPlatformPersistenceCompositionRoots(state, violations);
	checkCodingAgentCompositionPersistenceBoundary(state, violations);
	checkToolEnvironmentBoundary(state, violations);
	checkPromptRequestAdapterBoundary(state, violations);
	checkRetiredAdapterOwnershipPaths(state, violations);
	checkNodeStateBackendBoundary(state, violations);
	checkExtensionModuleBoundary(state, violations);
	checkResourceAccessBoundary(state, violations);
	checkCommandExecutionBoundary(state, violations);
	checkExecutionModeHostBoundary(state, violations);
	checkToolResultArtifactBoundary(state, violations);
	checkBootstrapBoundary(state, violations);
	checkResourcePackageHostBoundary(state, violations);
	checkHostOwnedResourceCompositionBoundary(state, violations);
	checkKnowledgeRuntimeBoundary(state, violations);
	checkMemoryRuntimeBoundary(state, violations);
	checkAskUserQuestionToolOwnership(state, violations);
	checkInvokeSkillToolOwnership(state, violations);
	checkMcpToolSearchOwnership(state, violations);
	checkSubagentControlToolOwnership(state, violations);
	checkRpcHostBoundary(state, violations);
	checkSdkSessionIdentityRuntimeBoundary(state, violations);
	checkRetiredLayerTerminology(state, violations);

	for (const path of state.sourcePaths) {
		if (path.startsWith(`${SOURCE_ROOT}/core/`) || path.startsWith(`${SOURCE_ROOT}/compat/`)) {
			violations.push(`${path}: retired implementation directory is outside the current architecture`);
		}
	}

	for (const edge of state.edges) {
		const target = resolveSourceTarget(edge.path, edge.specifier);
		if (
			isAdapterPath(edge.path) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(
				`${edge.path}:${edge.line}: Adapter must consume platform-neutral facts, not a Node implementation`,
			);
		}
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
				`${edge.path}:${edge.line}: Coding Agent domain depends on orchestration or implementation (${edge.specifier})`,
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

function checkRetiredAdapterOwnershipPaths(state, violations) {
	const retiredPaths = new Set([
		`${SOURCE_ROOT}/adapters/runtime-core/ecosystem-hook-tool-wrapper.ts`,
		`${SOURCE_ROOT}/adapters/runtime-core/extension-observation-adapter.ts`,
		`${SOURCE_ROOT}/adapters/runtime-core/extension-run-adapter.ts`,
		`${SOURCE_ROOT}/adapters/runtime-core/extension-tool-wrapper.ts`,
		`${SOURCE_ROOT}/adapters/extensions/extension-tool-interceptor.ts`,
	]);
	for (const path of state.sourcePaths) {
		if (retiredPaths.has(path)) {
			violations.push(`${path}: implementation belongs to its Extension or ecosystem owner`);
		}
	}
}

function checkBootstrapBoundary(state, violations) {
	const bootstrapRoot = `${SOURCE_ROOT}/bootstrap/`;
	const bootstrapPath = `${bootstrapRoot}coding-agent-bootstrap.ts`;
	const cliCompositionPath = "packages/cli-app/src/coding-agent-bootstrap.ts";
	const cliResourceCompositionPath = "packages/cli-app/src/coding-agent-resource-runtime.ts";
	const retiredPaths = new Set([
		`${SOURCE_ROOT}/host/coding-agent-host-bootstrap.ts`,
		`${SOURCE_ROOT}/host/coding-agent-cli-bootstrap.ts`,
	]);

	for (const file of state.files) {
		if (retiredPaths.has(file.path)) {
			violations.push(`${file.path}: platform bootstrap belongs to the application Composition Root`);
		}
		if (file.path.startsWith(`${SOURCE_ROOT}/host/extensions/compatibility/`)) {
			violations.push(`${file.path}: Extension compatibility rules belong to the Extension domain`);
		}
		if (
			file.path.startsWith(bootstrapRoot) &&
			(/\bprocess\s*\./.test(file.text) || /\bgetAgentDir\b|\brunMigrations\b|\bNode\w*Storage\b/.test(file.text))
		) {
			violations.push(`${file.path}: Coding Agent Bootstrap must consume host-owned state and environment facts`);
		}
	}
	for (const edge of state.edges) {
		if (
			edge.path.startsWith(bootstrapRoot) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Coding Agent Bootstrap must not select a Node implementation`);
		}
	}

	const bootstrap = state.files.find((file) => file.path === bootstrapPath);
	if (
		bootstrap &&
		(!/\bsettingsManager\s*:\s*SettingsRuntime\b/.test(bootstrap.text) ||
			!/\bauthStorage\s*:\s*CodingAgentAuthRuntime\b/.test(bootstrap.text) ||
			!/\bmodelRegistry\s*:\s*CodingAgentModelRuntime\b/.test(bootstrap.text) ||
			!/\bcreateResourceRuntime\s*:\s*CodingAgentBootstrapResourceFactory\b/.test(bootstrap.text))
	) {
		violations.push(`${bootstrapPath}: Coding Agent Bootstrap must require explicit host-owned dependencies`);
	}

	const cliComposition = state.files.find((file) => file.path === cliCompositionPath);
	const cliResourceComposition = state.files.find((file) => file.path === cliResourceCompositionPath);
	if (
		cliComposition &&
		(!/\bcreateCodingAgentBootstrap\s*\(/.test(cliComposition.text) ||
			!/\bNodeTransactionalTextStorage\b/.test(cliComposition.text) ||
			!/\brunCodingAgentStartupMigrations\s*\(\s*\{\s*cwd\s*,\s*agentDir\s*\}\s*\)/.test(cliComposition.text) ||
			!/\bcreateCliSettingsRuntime\b/.test(cliComposition.text) ||
			!/\bcreateCliSessionResourceRuntime\b/.test(cliComposition.text) ||
			!cliResourceComposition ||
			!/\bNodeScopedTextStorage\b/.test(cliResourceComposition.text) ||
			!/\bcreateNodeResourcePackageHost\b/.test(cliResourceComposition.text) ||
			!/\bcreateNodeCommandExecutor\b/.test(cliResourceComposition.text))
	) {
		violations.push(`${cliCompositionPath}: CLI host composition must select Node dependencies explicitly`);
	}
}

function checkToolResultArtifactBoundary(state, violations) {
	const policyPath = `${SOURCE_ROOT}/tool-results/result-policy.ts`;
	const retiredPaths = new Set([
		`${SOURCE_ROOT}/tool-results/contracts.ts`,
		`${SOURCE_ROOT}/tool-results/file-result-artifact-store.ts`,
		`${SOURCE_ROOT}/tool-results/session-artifact-cleaner.ts`,
		`${SOURCE_ROOT}/mcp/runtime/file-result-artifact-store.ts`,
		`${SOURCE_ROOT}/mcp/runtime/result-policy.ts`,
	]);
	for (const file of state.files) {
		if (retiredPaths.has(file.path)) {
			violations.push(`${file.path}: result artifact file implementation belongs to runtime-node`);
		}
	}
	for (const edge of state.edges) {
		if (
			edge.path === policyPath &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Tool Result policy must consume an Artifact Store contract`);
		}
	}

	const composition = state.files.find((file) => file.path === `${SOURCE_ROOT}/composition/runtime-composition.ts`);
	if (composition && !/\bresultPolicy\s*:\s*options\.codingToolResultPolicy\b/.test(composition.text)) {
		violations.push(`${composition.path}: Coding Agent Composition must forward the host Tool Result policy`);
	}
	for (const path of TOOL_RESULT_POLICY_COMPOSITION_ROOTS) {
		const file = state.files.find((candidate) => candidate.path === path);
		if (file && !/\bcodingToolResultPolicy\s*:/.test(file.text) && !/\bcodingToolResultPolicy,/.test(file.text)) {
			violations.push(`${path}: Node Host Composition Root must inject codingToolResultPolicy`);
		}
	}
}

function checkRetiredLayerTerminology(state, violations) {
	for (const file of state.files) {
		if (!file.path.startsWith(`${SOURCE_ROOT}/`)) continue;
		if (RETIRED_LAYER_TERM_PATTERN.test(file.path) || RETIRED_LAYER_TERM_PATTERN.test(file.text)) {
			violations.push(`${file.path}: implementation uses a retired architecture-layer term`);
		}
	}
	for (const packageExport of state.packageExports) {
		if (RETIRED_LAYER_TERM_PATTERN.test(packageExport)) {
			violations.push(
				`${PACKAGE_ROOT}/package.json: export ${packageExport} uses a retired architecture-layer term`,
			);
		}
	}
}

function checkResourceAccessBoundary(state, violations) {
	const portableResourcePaths = new Set([
		`${SOURCE_ROOT}/resources/contracts/resource-access.ts`,
		`${SOURCE_ROOT}/resources/runtime/context-resources.ts`,
		`${SOURCE_ROOT}/resources/runtime/resource-state.ts`,
		`${SOURCE_ROOT}/resources/runtime/session-resource-runtime.ts`,
		`${SOURCE_ROOT}/resources/runtime/theme-resources.ts`,
		`${SOURCE_ROOT}/resources/runtime/prompt-resource-state.ts`,
		`${SOURCE_ROOT}/resources/runtime/skill-resource-state.ts`,
		`${SOURCE_ROOT}/resources/prompts/arguments.ts`,
		`${SOURCE_ROOT}/resources/prompts/contracts.ts`,
		`${SOURCE_ROOT}/resources/prompts/discovery.ts`,
		`${SOURCE_ROOT}/resources/prompts/index.ts`,
		`${SOURCE_ROOT}/resources/skills/contracts.ts`,
		`${SOURCE_ROOT}/resources/skills/discovery.ts`,
		`${SOURCE_ROOT}/resources/skills/index.ts`,
		`${SOURCE_ROOT}/resources/skills/prompt.ts`,
		`${SOURCE_ROOT}/model-context/prompt-snapshot.ts`,
		`${SOURCE_ROOT}/resources/prompt-resources/prompt-resource-expander.ts`,
		`${SOURCE_ROOT}/extensions/host-contracts.ts`,
		`${SOURCE_ROOT}/extensions/pi-compat/loading.ts`,
		`${SOURCE_ROOT}/extensions/runtime/discovery/extension-paths.ts`,
		`${SOURCE_ROOT}/extensions/runtime/loading/load-extensions.ts`,
		`${SOURCE_ROOT}/extensions/runtime/registration/extension-registration.ts`,
		`${SOURCE_ROOT}/resources/runtime/extension-resources.ts`,
		`${SOURCE_ROOT}/resources/packages/resource-discovery.ts`,
		`${SOURCE_ROOT}/resources/packages/resource-patterns.ts`,
		`${SOURCE_ROOT}/resources/packages/resource-projection.ts`,
		`${SOURCE_ROOT}/resources/packages/package-source-runtime.ts`,
		`${SOURCE_ROOT}/resources/packages/package-lifecycle.ts`,
		`${SOURCE_ROOT}/resources/packages/source-spec.ts`,
		`${SOURCE_ROOT}/resources/packages/resource-package-locations.ts`,
	]);
	for (const edge of state.edges) {
		if (
			portableResourcePaths.has(edge.path) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(
				`${edge.path}:${edge.line}: portable resource access must consume ResourceAccessPort, not a Node implementation`,
			);
		}
	}

	const runtimeContract = state.files.find(
		(file) => file.path === `${SOURCE_ROOT}/resources/contracts/resource-runtime.ts`,
	);
	if (runtimeContract && !/\bresourceAccess\s*:\s*ResourceAccessPort\b/.test(runtimeContract.text)) {
		violations.push(`${runtimeContract.path}: SessionResourceRuntimeOptions must require ResourceAccessPort`);
	}
	if (runtimeContract && !/\bthemeParser\s*:\s*ThemeResourceParser\b/.test(runtimeContract.text)) {
		violations.push(`${runtimeContract.path}: SessionResourceRuntimeOptions must require ThemeResourceParser`);
	}
	if (
		runtimeContract &&
		(!/\bextensionFactoryLoader\s*:\s*ExtensionFactoryLoader\b/.test(runtimeContract.text) ||
			!/\bextensionCommandExecutor\s*:\s*ExtensionCommandExecutor\b/.test(runtimeContract.text))
	) {
		violations.push(`${runtimeContract.path}: SessionResourceRuntimeOptions must require Extension Host Ports`);
	}

	for (const file of state.files) {
		if (file.path.startsWith(`${SOURCE_ROOT}/resources/`) && /\breadSkillContent\b/.test(file.text)) {
			violations.push(`${file.path}: Skill consumers must use the materialized resource snapshot`);
		}
	}
}

function checkCommandExecutionBoundary(state, violations) {
	const commandExecutionRoot = `${SOURCE_ROOT}/host/command-execution/`;
	for (const edge of state.edges) {
		if (edge.path.startsWith(commandExecutionRoot) && edge.specifier.startsWith("node:")) {
			violations.push(
				`${edge.path}:${edge.line}: command execution implementation belongs to runtime-node, not Coding Agent`,
			);
		}
	}
}

function checkExecutionModeHostBoundary(state, violations) {
	const retiredExecutionModeRoot = `${SOURCE_ROOT}/adapters/runtime-core/execution-mode/`;
	const sandboxHostRoot = `${SOURCE_ROOT}/host/session-execution/sandbox/`;
	const retiredPlatformFiles = new Set([
		`${sandboxHostRoot}linux-bwrap-tools.ts`,
		`${sandboxHostRoot}macos-seatbelt-tools.ts`,
		`${sandboxHostRoot}windows-sandbox-policy.ts`,
		`${sandboxHostRoot}windows-sandbox-tools.ts`,
		`${sandboxHostRoot}workspace-guard.ts`,
	]);
	for (const file of state.files) {
		if (file.path.startsWith(retiredExecutionModeRoot)) {
			violations.push(`${file.path}: sandbox host policy must not return to the Runtime adapter directory`);
		}
		if (retiredPlatformFiles.has(file.path)) {
			violations.push(`${file.path}: OS sandbox implementation belongs to runtime-node`);
		}
		if (
			file.path.startsWith(sandboxHostRoot) &&
			(/\bNodeJS\s*\./.test(file.text) || /\bprocess\s*\./.test(file.text))
		) {
			violations.push(`${file.path}: sandbox policy must consume Host Services, not Node globals`);
		}
	}
	for (const edge of state.edges) {
		if (edge.path.startsWith(sandboxHostRoot) && edge.specifier.startsWith("node:")) {
			violations.push(`${edge.path}:${edge.line}: OS sandbox implementation belongs to runtime-node`);
		}
		if (edge.path.startsWith(sandboxHostRoot) && edge.specifier.startsWith("@vetta/runtime-node")) {
			violations.push(`${edge.path}:${edge.line}: sandbox policy must consume injected Host Services`);
		}
	}
}

function checkExtensionModuleBoundary(state, violations) {
	const retiredPaths = new Set([
		`${SOURCE_ROOT}/extensions/runtime/loading/extension-module-loader.ts`,
		`${SOURCE_ROOT}/extensions/runtime/exec-command.ts`,
	]);
	for (const file of state.files) {
		if (retiredPaths.has(file.path)) {
			violations.push(`${file.path}: Node Extension execution belongs behind Host Ports`);
		}
		if (
			file.path.startsWith(`${SOURCE_ROOT}/extensions/`) &&
			(/\bBuffer\b/.test(file.text) || /\bNodeJS\s*\./.test(file.text))
		) {
			violations.push(`${file.path}: Extension contracts must use platform-neutral data types`);
		}
	}
	for (const edge of state.edges) {
		if (
			edge.path.startsWith(`${SOURCE_ROOT}/extensions/`) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Extension semantics must not depend on Node implementations`);
		}
	}
}

function checkResourcePackageHostBoundary(state, violations) {
	const retiredEffectsPath = `${SOURCE_ROOT}/resources/packages/package-effects.ts`;
	const runtimePath = `${SOURCE_ROOT}/resources/packages/package-source-runtime.ts`;
	const sourceSpecPath = `${SOURCE_ROOT}/resources/packages/source-spec.ts`;
	if (state.sourcePaths.includes(retiredEffectsPath)) {
		violations.push(`${retiredEffectsPath}: Resource Package Node effects belong to runtime-node`);
	}

	const runtime = state.files.find((file) => file.path === runtimePath);
	if (
		runtime &&
		(!/\bcommands\s*:\s*ResourcePackageCommandPort\b/.test(runtime.text) ||
			!/\bdigest\s*:\s*ResourcePackageDigestPort\b/.test(runtime.text) ||
			!/\bregistry\s*:\s*ResourcePackageRegistryPort\b/.test(runtime.text) ||
			!/\benvironment\s*:\s*ResourcePackageEnvironmentPort\b/.test(runtime.text) ||
			!/\blocationFacts\s*:\s*ResourcePackageLocationFacts\b/.test(runtime.text) ||
			!/\bresourceAccess\s*:\s*ResourceAccessPort\b/.test(runtime.text) ||
			!/\bfiles\s*:\s*ResourcePackageFilePort\b/.test(runtime.text) ||
			!/\bmanagedSkillsDir\s*:\s*string\b/.test(runtime.text))
	) {
		violations.push(`${runtimePath}: ResourcePackageRuntimeOptions must require all Host Ports`);
	}
	if (runtime && /\brunSync\s*\(/.test(runtime.text)) {
		violations.push(`${runtimePath}: Resource Package runtime must not synchronously query Node commands`);
	}
	if (
		runtime &&
		(/\bnew\s+(?:NodeResourcePackageCommands|NpmResourcePackageRegistry)\b/.test(runtime.text) ||
			/\bprocess\.env\.PI_OFFLINE\b/.test(runtime.text))
	) {
		violations.push(`${runtimePath}: Resource Package runtime must not select Node defaults`);
	}

	const sourceSpec = state.files.find((file) => file.path === sourceSpecPath);
	if (sourceSpec && /\bclass\s+ResourcePackageLocations\b/.test(sourceSpec.text)) {
		violations.push(`${sourceSpecPath}: Resource source parsing must not own package location policy`);
	}
}

function checkHostOwnedResourceCompositionBoundary(state, violations) {
	const retiredResourceFactoryPath = `${SOURCE_ROOT}/host/coding-agent-resource-runtime.ts`;
	const retiredPromptFactoryPath = `${SOURCE_ROOT}/composition/turn/prompt-runtime-factory.ts`;
	const publicResourcesPath = `${SOURCE_ROOT}/public-api/resources.ts`;
	const compositionOptionsPath = `${SOURCE_ROOT}/composition/contracts/runtime-composition-options.ts`;
	const transactionPath = `${SOURCE_ROOT}/composition/session-initialization/transaction.ts`;
	const cliControlPath = `${SOURCE_ROOT}/host/coding-agent-cli-control.ts`;

	if (state.sourcePaths.includes(retiredResourceFactoryPath)) {
		violations.push(`${retiredResourceFactoryPath}: Node resource composition belongs to application hosts`);
	}
	if (state.sourcePaths.includes(retiredPromptFactoryPath)) {
		violations.push(`${retiredPromptFactoryPath}: Prompt resource selection belongs to application hosts`);
	}

	const publicResources = state.files.find((file) => file.path === publicResourcesPath);
	if (
		publicResources &&
		/\bcreateCodingAgent(?:Settings|ResourcePackage|SessionResource|SkillResource)Runtime\b/.test(
			publicResources.text,
		)
	) {
		violations.push(`${publicResourcesPath}: Resources facade must expose portable constructors only`);
	}

	const compositionOptions = state.files.find((file) => file.path === compositionOptionsPath);
	if (compositionOptions && !/\bcreatePromptRuntimeSources\??\s*:/.test(compositionOptions.text)) {
		violations.push(`${compositionOptionsPath}: Composition must accept host-owned Prompt runtime sources`);
	}

	const transaction = state.files.find((file) => file.path === transactionPath);
	if (transaction && !/\bruntimeSourceFactory\s*:\s*createPromptRuntimeSources\b/.test(transaction.text)) {
		violations.push(`${transactionPath}: Session initialization must forward host-owned Prompt runtime sources`);
	}

	const cliControl = state.files.find((file) => file.path === cliControlPath);
	if (cliControl && !/\bcreatePackageCommandRuntime\b/.test(cliControl.text)) {
		violations.push(`${cliControlPath}: CLI package commands must receive an explicit runtime factory`);
	}
}

function checkKnowledgeRuntimeBoundary(state, violations) {
	const featureRoot = `${SOURCE_ROOT}/features/knowledge/`;
	const retiredFactoryPath = `${SOURCE_ROOT}/composition/coding-agent-knowledge-runtime.ts`;
	const compositionOptionsPath = `${SOURCE_ROOT}/composition/contracts/runtime-composition-options.ts`;
	const toolSurfacePath = `${SOURCE_ROOT}/composition/tool-surface/runtime-tool-surface.ts`;
	const retiredNodeToolPrefixes = [
		"packages/runtime-node/src/coding/tools/kb-filter-by-tags/",
		"packages/runtime-node/src/coding/tools/kb-list-tags/",
		"packages/runtime-node/src/coding/tools/kb-write-page/",
	];

	if (state.sourcePaths.includes(retiredFactoryPath)) {
		violations.push(`${retiredFactoryPath}: Knowledge platform implementation belongs to application hosts`);
	}
	for (const edge of state.edges) {
		if (
			edge.path.startsWith(featureRoot) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Knowledge Feature must consume portable operations`);
		}
	}
	for (const file of state.files) {
		if (retiredNodeToolPrefixes.some((prefix) => file.path.startsWith(prefix))) {
			violations.push(`${file.path}: Knowledge Tool definitions belong to the Coding Agent feature`);
		}
	}

	const nodeCodingEntry = state.files.find((file) => file.path === "packages/runtime-node/src/coding/index.ts");
	if (
		nodeCodingEntry &&
		/\bcreateKb(?:FilterByTags|ListTags|WritePage)Tool\b|\.\/tools\/kb-(?:filter-by-tags|list-tags|write-page)\//.test(
			nodeCodingEntry.text,
		)
	) {
		violations.push(`${nodeCodingEntry.path}: runtime-node must not export Coding Agent Knowledge Tools`);
	}

	const compositionOptions = state.files.find((file) => file.path === compositionOptionsPath);
	if (compositionOptions) {
		if (!/\bknowledgeRuntime\??\s*:\s*CodingAgentKnowledgeRuntime\b/.test(compositionOptions.text)) {
			violations.push(`${compositionOptionsPath}: Composition must accept an explicit Knowledge runtime`);
		}
		if (/\bknowledge(?:Root|Enabled)\??\s*:/.test(compositionOptions.text)) {
			violations.push(`${compositionOptionsPath}: Composition must not infer Knowledge platform availability`);
		}
	}

	const toolSurface = state.files.find((file) => file.path === toolSurfacePath);
	if (
		toolSurface &&
		(/\bprocess\s*\./.test(toolSurface.text) ||
			/\bgetKnowledgeDir\b|\bcreateNodeKnowledgeRuntime\b|\bknowledge(?:Root|Enabled)\b/.test(toolSurface.text))
	) {
		violations.push(`${toolSurfacePath}: Tool Surface must consume the injected Knowledge runtime`);
	}

	for (const path of KNOWLEDGE_RUNTIME_COMPOSITION_ROOTS) {
		const file = state.files.find((candidate) => candidate.path === path);
		if (!file) continue;
		const importsFactory = state.edges.some(
			(edge) =>
				edge.path === path &&
				edge.specifier === "@vetta/runtime-node/host" &&
				edge.names.includes("createNodeKnowledgeRuntime"),
		);
		if (!importsFactory || !/\bknowledgeRuntime\s*:/.test(file.text)) {
			violations.push(`${path}: Node Host Composition Root must inject createNodeKnowledgeRuntime`);
		}
	}
}

function checkMemoryRuntimeBoundary(state, violations) {
	const memoryRoot = `${SOURCE_ROOT}/memory/`;
	const compositionOptionsPath = `${SOURCE_ROOT}/composition/contracts/runtime-composition-options.ts`;
	const peripheralAssemblyPath = `${SOURCE_ROOT}/composition/session-initialization/peripheral-assembly.ts`;
	const retiredNodeToolPrefixes = ["packages/runtime-node/src/coding/tools/memory/"];

	for (const edge of state.edges) {
		if (
			edge.path.startsWith(memoryRoot) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Memory semantics must consume portable storage ports`);
		}
	}
	for (const file of state.files) {
		if (retiredNodeToolPrefixes.some((prefix) => file.path.startsWith(prefix))) {
			violations.push(`${file.path}: Memory Tool definitions belong to the Coding Agent feature`);
		}
		if (file.path.startsWith(memoryRoot) && /\bFileMemory(?:Store|Journal)\b/.test(file.text)) {
			violations.push(`${file.path}: Memory semantics must not contain a file-backed implementation`);
		}
	}

	const nodeCodingEntry = state.files.find((file) => file.path === "packages/runtime-node/src/coding/index.ts");
	if (nodeCodingEntry && /\bcreateMemoryTool\b|\.\/tools\/memory\//.test(nodeCodingEntry.text)) {
		violations.push(`${nodeCodingEntry.path}: runtime-node must not export Coding Agent Memory Tools`);
	}

	const compositionOptions = state.files.find((file) => file.path === compositionOptionsPath);
	if (compositionOptions && !/\bcreateMemoryRolloverRuntime\??\s*:/.test(compositionOptions.text)) {
		violations.push(`${compositionOptionsPath}: Composition must accept an explicit Memory runtime factory`);
	}

	const peripheralAssembly = state.files.find((file) => file.path === peripheralAssemblyPath);
	if (
		peripheralAssembly &&
		(/\bnew\s+CodingAgentMemoryRolloverOrchestrator\b/.test(peripheralAssembly.text) ||
			/\bjoin\s*\([^)]*MEMORY\.md/.test(peripheralAssembly.text))
	) {
		violations.push(`${peripheralAssembly.path}: Memory host storage must be selected by the Composition Root`);
	}

	for (const path of MEMORY_RUNTIME_COMPOSITION_ROOTS) {
		const file = state.files.find((candidate) => candidate.path === path);
		if (!file) continue;
		const importsStorage = state.edges.some(
			(edge) =>
				edge.path === path &&
				edge.specifier === "@vetta/runtime-node/host" &&
				edge.names.includes("NodeTextFileStorage"),
		);
		if (!importsStorage || !/\bcreateMemoryRolloverRuntime\s*:/.test(file.text)) {
			violations.push(`${path}: Node Host Composition Root must inject NodeTextFileStorage for Memory`);
		}
	}
}

function checkAskUserQuestionToolOwnership(state, violations) {
	const featureRoot = `${SOURCE_ROOT}/features/ask-user-question/`;
	const retiredCompositionPath = `${SOURCE_ROOT}/composition/tool-surface/ask-user-question-feature.ts`;
	const retiredNodeToolRoot = "packages/runtime-node/src/coding/tools/ask-user-question/";

	for (const edge of state.edges) {
		if (
			edge.path.startsWith(featureRoot) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Ask User Question Feature must consume portable Runtime ports`);
		}
	}
	for (const file of state.files) {
		if (file.path === retiredCompositionPath) {
			violations.push(`${file.path}: Ask User Question belongs to its Coding Agent feature`);
		}
		if (file.path.startsWith(retiredNodeToolRoot)) {
			violations.push(`${file.path}: Ask User Question Tool definitions belong to the Coding Agent feature`);
		}
	}

	const nodeCodingEntry = state.files.find((file) => file.path === "packages/runtime-node/src/coding/index.ts");
	if (
		nodeCodingEntry &&
		/\b(?:createAskUserQuestionTool|AskUserQuestionToolInputSchema)\b|\.\/tools\/ask-user-question\//.test(
			nodeCodingEntry.text,
		)
	) {
		violations.push(`${nodeCodingEntry.path}: runtime-node must not export Coding Agent Ask User Question Tools`);
	}
}

function checkInvokeSkillToolOwnership(state, violations) {
	const skillRoot = `${SOURCE_ROOT}/resources/skills/`;
	const retiredNodeToolRoot = "packages/runtime-node/src/coding/tools/invoke-skill/";

	for (const edge of state.edges) {
		if (
			edge.path.startsWith(skillRoot) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Skill semantics must consume portable Runtime and resource ports`);
		}
	}
	for (const file of state.files) {
		if (file.path.startsWith(retiredNodeToolRoot)) {
			violations.push(`${file.path}: Invoke Skill Tool definitions belong to the Coding Agent Skill domain`);
		}
	}

	const nodeCodingEntry = state.files.find((file) => file.path === "packages/runtime-node/src/coding/index.ts");
	if (
		nodeCodingEntry &&
		/\b(?:createInvokeSkillTool|InvokeSkillToolInputSchema)\b|\.\/tools\/invoke-skill\//.test(nodeCodingEntry.text)
	) {
		violations.push(`${nodeCodingEntry.path}: runtime-node must not export Coding Agent Invoke Skill Tools`);
	}
}

function checkMcpToolSearchOwnership(state, violations) {
	const retiredNodeToolRoot = "packages/runtime-node/src/coding/tools/tool-search/";
	for (const file of state.files) {
		if (file.path.startsWith(retiredNodeToolRoot)) {
			violations.push(`${file.path}: MCP Tool Search belongs to runtime-mcp`);
		}
	}

	const nodeCodingEntry = state.files.find((file) => file.path === "packages/runtime-node/src/coding/index.ts");
	if (
		nodeCodingEntry &&
		/\b(?:createToolSearchTool|ToolSearchToolInputSchema|scoreDeferredTools)\b|\.\/tools\/tool-search\//.test(
			nodeCodingEntry.text,
		)
	) {
		violations.push(`${nodeCodingEntry.path}: runtime-node must not duplicate runtime-mcp Tool Search`);
	}
}

function checkSubagentControlToolOwnership(state, violations) {
	const productToolRoot = `${SOURCE_ROOT}/composition/subagent/tools/`;
	const retiredNodeToolRoots = [
		"dispatch-workflows",
		"followup-task",
		"interrupt-agent",
		"list-agents",
		"send-message",
		"spawn-agent",
		"wait-agent",
	].map((name) => `packages/runtime-node/src/coding/tools/${name}/`);

	for (const edge of state.edges) {
		if (
			edge.path.startsWith(productToolRoot) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Subagent control Tools must consume portable Runtime Ports`);
		}
	}
	for (const file of state.files) {
		if (retiredNodeToolRoots.some((root) => file.path.startsWith(root))) {
			violations.push(`${file.path}: Subagent control Tool definitions belong to the Coding Agent Subagent feature`);
		}
	}

	const nodeCodingEntry = state.files.find((file) => file.path === "packages/runtime-node/src/coding/index.ts");
	if (
		nodeCodingEntry &&
		/\b(?:createDispatchWorkflows|createFollowupTask|createInterruptAgent|createListAgents|createSendMessage|createSpawnAgent|createWaitAgent)Tool\b|\.\/tools\/(?:dispatch-workflows|followup-task|interrupt-agent|list-agents|send-message|spawn-agent|wait-agent)\//.test(
			nodeCodingEntry.text,
		)
	) {
		violations.push(`${nodeCodingEntry.path}: runtime-node must not export Coding Agent Subagent control Tools`);
	}
}

function checkRpcHostBoundary(state, violations) {
	const rpcRoot = `${SOURCE_ROOT}/modes/rpc/`;
	const rpcModePath = `${rpcRoot}rpc-mode.ts`;
	const rpcClientPath = `${rpcRoot}rpc-client.ts`;
	const hostBridgePaths = new Set([`${rpcRoot}rpc-extension-ui-bridge.ts`, `${rpcRoot}rpc-host-bridge.ts`]);
	const portableRpcPaths = new Set([rpcModePath, rpcClientPath, ...hostBridgePaths]);
	for (const edge of state.edges) {
		if (portableRpcPaths.has(edge.path) && edge.specifier.startsWith("node:")) {
			violations.push(`${edge.path}:${edge.line}: RPC protocol semantics must consume host transport and ID ports`);
		}
	}
	for (const file of state.files) {
		if (!portableRpcPaths.has(file.path)) continue;
		if (/\bprocess\.(?:env|stdin|stdout|exit)\b|\brandomUUID\s*\(/.test(file.text)) {
			violations.push(`${file.path}: RPC protocol semantics must not access Node process or randomness directly`);
		}
	}

	const rpcMode = state.files.find((file) => file.path === rpcModePath);
	if (rpcMode && (!/transport:\s*RpcFrameTransport/.test(rpcMode.text) || !/createRequestId/.test(rpcMode.text))) {
		violations.push(`${rpcModePath}: RPC mode must require explicit transport and request ID ports`);
	}
	for (const path of RPC_HOST_COMPOSITION_ROOTS) {
		const file = state.files.find((candidate) => candidate.path === path);
		if (!file) continue;
		const importsTransport = state.edges.some(
			(edge) => edge.path === path && edge.names.includes("NodeRpcJsonlTransport"),
		);
		if (
			!importsTransport ||
			!/transport:\s*new\s+NodeRpcJsonlTransport/.test(file.text) ||
			!/createRequestId:/.test(file.text)
		) {
			violations.push(`${path}: Node RPC Host must inject JSONL transport, exit and request ID ports`);
		}
	}

	const nodeClientTransportPath = "packages/cli-app/src/rpc/node-rpc-client-transport.ts";
	const nodeClientTransport = state.files.find((file) => file.path === nodeClientTransportPath);
	if (nodeClientTransport) {
		const importsPort = state.edges.some(
			(edge) =>
				edge.path === nodeClientTransportPath &&
				edge.specifier === "@vetta/coding-agent/rpc" &&
				edge.names.includes("RpcClientTransport"),
		);
		if (!importsPort || !/implements\s+RpcClientTransport/.test(nodeClientTransport.text)) {
			violations.push(`${nodeClientTransportPath}: Node RPC Client transport must implement the public RPC Port`);
		}
	}
}

function checkSdkSessionIdentityRuntimeBoundary(state, violations) {
	const runtimeFactoryPath = `${SOURCE_ROOT}/host/sdk-session/runtime-factory.ts`;
	const sessionHostPath = `${SOURCE_ROOT}/host/sdk-session/session-host.ts`;
	const nodeRuntimePath = `${SOURCE_ROOT}/host/sdk-session/node-session-identity-runtime.ts`;
	for (const edge of state.edges) {
		if (
			edge.path === runtimeFactoryPath &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: SDK Session factory must consume an identity runtime Port`);
		}
	}

	const runtimeFactory = state.files.find((file) => file.path === runtimeFactoryPath);
	if (runtimeFactory) {
		if (/\bprocess\.|\brandomUUID\s*\(|\bFileConversationRuntimeSessionCatalog\b/.test(runtimeFactory.text)) {
			violations.push(`${runtimeFactoryPath}: SDK Session factory must not select Node identity defaults`);
		}
		if (
			!/^\s*readonly\s+identityRuntime:\s*CodingAgentSdkSessionIdentityRuntime\s*;/m.test(runtimeFactory.text) ||
			!/options\.identityRuntime\.resolveStorage\s*\(/.test(runtimeFactory.text) ||
			!/options\.identityRuntime\.createSessionCatalog\s*\(/.test(runtimeFactory.text)
		) {
			violations.push(`${runtimeFactoryPath}: SDK Session factory must require the complete identity runtime Port`);
		}
	}

	const sessionHost = state.files.find((file) => file.path === sessionHostPath);
	if (sessionHost) {
		const importsNodeRuntime = state.edges.some(
			(edge) => edge.path === sessionHostPath && edge.names.includes("nodeCodingAgentSdkSessionIdentityRuntime"),
		);
		if (
			!importsNodeRuntime ||
			!/identityRuntime:\s*[^,]*nodeCodingAgentSdkSessionIdentityRuntime/.test(sessionHost.text)
		) {
			violations.push(`${sessionHostPath}: default SDK Host must inject the Node Session identity runtime`);
		}
	}

	const nodeRuntime = state.files.find((file) => file.path === nodeRuntimePath);
	if (nodeRuntime && !/CodingAgentSdkSessionIdentityRuntime/.test(nodeRuntime.text)) {
		violations.push(`${nodeRuntimePath}: Node SDK identity adapter must implement the identity runtime Port`);
	}
}

function checkToolEnvironmentBoundary(state, violations) {
	const toolCompositionPath = `${SOURCE_ROOT}/composition/tool-surface/runtime-tools-composition.ts`;
	const sessionExecutionPath = `${SOURCE_ROOT}/host/session-execution/execution-runtime.ts`;
	const sandboxRegistrationPath = `${SOURCE_ROOT}/host/session-execution/sandbox-tool-registrations.ts`;
	const pathPolicyRoot = `${SOURCE_ROOT}/tool-policy/path/`;
	const platformFactories = [
		"packages/cli-app/src/rpc/runtime-host/cli-tool-environment.ts",
		"packages/runtime-desktop/src/coding-agent-tool-environment.ts",
	];
	const migratedCompositionRoots = TOOL_ENVIRONMENT_COMPOSITION_ROOTS.filter(
		(path) => path !== `${SOURCE_ROOT}/host/sdk-session/session-host.ts`,
	);
	const retiredNodeImplementationPaths = [`${SOURCE_ROOT}/adapters/runtime-tools/`];
	for (const file of state.files) {
		if (
			retiredNodeImplementationPaths.some((path) =>
				path.endsWith("/") ? file.path.startsWith(path) : file.path === path,
			)
		) {
			violations.push(`${file.path}: Node command and executable implementations belong to runtime-node`);
		}
	}
	for (const edge of state.edges) {
		if (edge.path === toolCompositionPath && edge.specifier === "@vetta/runtime-node/coding") {
			violations.push(
				`${edge.path}:${edge.line}: Coding Agent tool composition must consume ToolEnvironment, not Node tools`,
			);
		}
		if (
			edge.path.startsWith(pathPolicyRoot) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Coding Agent path policy must consume Host path boundaries`);
		}
		if (
			(edge.path === sessionExecutionPath || edge.path === sandboxRegistrationPath) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(`${edge.path}:${edge.line}: Session execution must consume its Host environment Port`);
		}
	}

	const composition = state.files.find((file) => file.path === `${SOURCE_ROOT}/composition/runtime-composition.ts`);
	if (composition && !/\bcreateToolEnvironment\s*:\s*options\.createToolEnvironment\b/.test(composition.text)) {
		violations.push(`${composition.path}: Coding Agent Composition must forward the host ToolEnvironment factory`);
	}

	for (const path of TOOL_ENVIRONMENT_COMPOSITION_ROOTS) {
		const file = state.files.find((candidate) => candidate.path === path);
		if (file && !/\bcreateToolEnvironment\s*(?::|,)/.test(file.text)) {
			violations.push(`${path}: host Composition Root must inject createToolEnvironment`);
		}
		if (file && !/\bcreateSessionExecutionEnvironment\s*(?::|,)/.test(file.text)) {
			violations.push(`${path}: host Composition Root must inject createSessionExecutionEnvironment`);
		}
	}
	for (const path of migratedCompositionRoots) {
		const file = state.files.find((candidate) => candidate.path === path);
		if (file && /\bcreateCodingAgentNodeToolEnvironment\b/.test(file.text)) {
			violations.push(`${path}: platform Composition Root must not select Coding Agent's legacy Node factory`);
		}
		if (file && /\bcreateCodingAgentNodeSessionExecutionEnvironment\b/.test(file.text)) {
			violations.push(
				`${path}: platform Composition Root must not select Coding Agent's legacy Session environment`,
			);
		}
	}
	for (const path of platformFactories) {
		const file = state.files.find((candidate) => candidate.path === path);
		if (
			file &&
			(!/\bcreateNodeHostCodingToolEnvironment\b/.test(file.text) ||
				!/\bcreateNodeHostSessionCommandEnvironment\b/.test(file.text) ||
				!/\bcreateNodeSandboxCodingToolEnvironment\b/.test(file.text) ||
				!/\bcreateCodingAgentEditPathPolicy\b/.test(file.text) ||
				!/\bcreateCodingAgentWritePathPolicy\b/.test(file.text))
		) {
			violations.push(
				`${path}: platform environment factory must compose Node mechanisms with Coding Agent policies`,
			);
		}
	}
}

function checkPromptRequestAdapterBoundary(state, violations) {
	const adapterPath = `${SOURCE_ROOT}/adapters/runtime-core/prompt-request-adapter.ts`;
	const adapter = state.files.find((file) => file.path === adapterPath);
	if (!adapter) return;

	for (const edge of state.edges) {
		if (
			edge.path === adapterPath &&
			(edge.specifier.startsWith("../../plugins/") ||
				edge.specifier.startsWith("../../extensions/") ||
				edge.specifier.startsWith("@vetta/ecosystem-adapter"))
		) {
			violations.push(`${edge.path}:${edge.line}: Prompt request Adapter must delegate domain policy`);
		}
	}

	if (
		!/private readonly runtime:\s*CodingAgentPromptRequestRuntime/.test(adapter.text) ||
		!/this\.runtime\.prepare\(readPromptRequest\(inputRequest\.payload\), context\)/.test(adapter.text)
	) {
		violations.push(`${adapterPath}: Prompt request Adapter must delegate preparation to its runtime Port`);
	}
}

function checkNodeStateBackendBoundary(state, violations) {
	const retiredBackendPaths = new Set([
		`${SOURCE_ROOT}/auth/storage/file-auth-storage-backend.ts`,
		`${SOURCE_ROOT}/settings/storage/file-settings-storage.ts`,
	]);
	for (const file of state.files) {
		if (retiredBackendPaths.has(file.path)) {
			violations.push(`${file.path}: Node file state backends belong to runtime-node`);
		}
	}
	for (const edge of state.edges) {
		if (
			edge.path.startsWith(`${SOURCE_ROOT}/settings/`) &&
			(edge.specifier.startsWith("node:") || edge.specifier.startsWith("@vetta/runtime-node"))
		) {
			violations.push(
				`${edge.path}:${edge.line}: Settings semantics must consume SettingsStoragePort, not a Node backend`,
			);
		}
	}
	const settingsEntry = state.files.find((file) => file.path === `${SOURCE_ROOT}/settings/index.ts`);
	if (settingsEntry && /\bcreate\s*:\s*createFileSettingsRuntime\b/.test(settingsEntry.text)) {
		violations.push(`${settingsEntry.path}: SettingsRuntime must not select a Node file backend`);
	}
}

function checkCodingAgentCompositionPersistenceBoundary(state, violations) {
	for (const edge of state.edges) {
		if (
			edge.path.startsWith(`${SOURCE_ROOT}/composition/`) &&
			edge.specifier === "@vetta/runtime-node/conversation"
		) {
			violations.push(
				`${edge.path}:${edge.line}: Coding Agent Composition must consume a persistence Port, not a Node implementation`,
			);
		}
	}

	const composition = state.files.find((file) => file.path === `${SOURCE_ROOT}/composition/runtime-composition.ts`);
	if (composition && !/\boptions\.createConversationPersistence\s*\(/.test(composition.text)) {
		violations.push(
			`${composition.path}: Coding Agent Composition must obtain conversation persistence from its host Port`,
		);
	}
}

function checkPlatformPersistenceCompositionRoots(state, violations) {
	for (const requirement of PLATFORM_PERSISTENCE_COMPOSITION_ROOTS) {
		const file = state.files.find((candidate) => candidate.path === requirement.path);
		if (!file) continue;
		const importsFactory = state.edges.some(
			(edge) =>
				edge.path === requirement.path &&
				edge.specifier === "@vetta/runtime-node/conversation" &&
				edge.names.includes(requirement.factory),
		);
		if (!importsFactory) {
			violations.push(
				`${requirement.path}: platform Composition Root must select ${requirement.factory} from runtime-node`,
			);
		}
		if (!/\bcreateConversationPersistence\s*:/.test(file.text)) {
			violations.push(`${requirement.path}: platform Composition Root must inject createConversationPersistence`);
		}
	}
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
		path.startsWith(`${SOURCE_ROOT}/host/sdk-session/contracts/`) ||
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
		.filter(
			(file) =>
				!file.path.startsWith(`${PACKAGE_ROOT}/`) &&
				(file.text.includes("@vetta/coding-agent") ||
					file.path === "packages/runtime-node/src/coding/index.ts" ||
					file.path.startsWith("packages/runtime-node/src/coding/tools/kb-")),
		);
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
