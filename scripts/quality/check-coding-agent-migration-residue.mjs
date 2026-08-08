/** Prevent retired Coding Agent migration seams from returning while reporting remaining cleanup debt. */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const SOURCE_ROOT = "packages/coding-agent/src";
const TEST_ROOT = "packages/coding-agent/test";
const CLI_SOURCE_ROOT = "packages/cli-app/src";
const CLI_TEST_ROOT = "packages/cli-app/test";
const RUNTIME_CORE_SOURCE_ROOT = "packages/runtime-core/src";
const RUNTIME_STORAGE_SOURCE_ROOT = "packages/runtime-storage/src";
const DESKTOP_SOURCE_ROOT = "packages/desktop-app/src";
const DESKTOP_MAIN_ROOT = `${DESKTOP_SOURCE_ROOT}/main`;
const DESKTOP_AGENT_RUNTIME_ROOT = `${DESKTOP_MAIN_ROOT}/agent-runtime`;
const RETIRED_DESKTOP_RUNTIME_ROOT = `${DESKTOP_MAIN_ROOT}/greenfield-runtime`;
const ADAPTER_ROOT = `${SOURCE_ROOT}/adapters`;
const COMPOSITION_ROOT = `${SOURCE_ROOT}/composition`;
const HOST_EXTENSION_ROOT = `${SOURCE_ROOT}/host/extensions`;
const SDK_SESSION_HOST_ROOT = `${SOURCE_ROOT}/host/sdk-session`;
const SDK_PUBLIC_API_ROOT = `${SOURCE_ROOT}/public-api/sdk`;
const SDK_RUNTIME_PUBLIC_API = `${SOURCE_ROOT}/public-api/runtime/session.ts`;
const SDK_TEST_ROOT = `${TEST_ROOT}/sdk`;
const SDK_SESSION_MIGRATION_IDENTITY_PATTERN =
	/\b(?:(?:[A-Za-z_$][\w$]*)?GreenfieldSdk[\w$]*|CodingAgentGreenfield[\w$]*)\b/g;
const DESKTOP_RUNTIME_MIGRATION_IDENTITY_PATTERN = /\bDesktopGreenfield[\w$]*\b/g;
const CLI_RUNTIME_TEST_MIGRATION_IDENTITY_PATTERN = /\bTestAgentRuntimeBackend\b|\bBACKENDS\b/g;
const PRODUCT_RUNTIME_MIGRATION_IDENTITY_PATTERN =
	/\b(?:ComposedGreenfieldRuntime[\w$]*|Greenfield(?:Document|Runtime|Session)[\w$]*|mapGreenfieldKernel[\w$]*)\b/g;
const CLI_HISTORICAL_ORACLE_REFERENCES = ["legacy-runtime-contract", "legacy-session-execution-fixture"];
const RUNTIME_CONTRACT_REQUIRED_FILTERS = [
	"contract.test.ts",
	"test/runtime-host.test.ts",
	"test/agent-runtime-selection.test.ts",
	"test/rpc-session-adapter.test.ts",
	"test/session-resource-close.test.ts",
	"test/agent-runtime-initialization-failure.test.ts",
	"test/agent-print-mode.test.ts",
];
const RUNTIME_CONTRACT_CONFIG_FILES = [
	"package.json",
	"packages/cli-app/package.json",
	".github/workflows/quality.yml",
];
const RETIRED_INFRASTRUCTURE_FILES = [
	`${SOURCE_ROOT}/utils/tools-manager.ts`,
	`${SOURCE_ROOT}/utils/shell.ts`,
	`${ADAPTER_ROOT}/runtime-tools/executable-resolver.ts`,
	`${TEST_ROOT}/tools-manager-resolver.test.ts`,
];
const LEGACY_INFRASTRUCTURE_ADAPTER_LABELS = ["legacy downloader", "legacy coding-agent runtime adapter"];

export const MIGRATION_RESIDUE_LIMITS = Object.freeze({
	adapterGreenfieldFiles: 0,
	cliGreenfieldFiles: 0,
	compositionGreenfieldFiles: 0,
	adapterCompositionEdgeFiles: 0,
	compositionPublicApiEdgeFiles: 0,
	hostExtensionCompositionEdgeFiles: 0,
	desktopRuntimeMigrationFiles: 0,
	desktopRuntimeMigrationIdentities: 0,
	desktopRuntimeSourceImportFiles: 0,
	cliRuntimeTestMigrationFiles: 0,
	cliRuntimeTestMigrationIdentities: 0,
	cliHistoricalOracleProductionReferences: 0,
	runtimeContractMissingFilters: 0,
	runtimeCutoverScriptReferences: 0,
	runtimeCoreMigrationFiles: 0,
	productRuntimeMigrationIdentities: 0,
	codingAgentGreenfieldTestFiles: 0,
	unclassifiedProductionGreenfieldOccurrences: 0,
	sourceCompatibilityShimReferences: 0,
	retiredInfrastructureFiles: 0,
	runtimeAdapterUtilityBackedgeFiles: 0,
	legacyInfrastructureAdapterLabels: 0,
});

export const RETIRED_MIGRATION_FILES = Object.freeze([
	`${SOURCE_ROOT}/modes/rpc/greenfield-rpc-capabilities.ts`,
	`${SOURCE_ROOT}/host/coding-agent-extension-compatibility.ts`,
	`${CLI_SOURCE_ROOT}/greenfield-print-session-adapter.ts`,
	`${CLI_SOURCE_ROOT}/rpc/greenfield-im-legacy-session-migration.ts`,
	`${CLI_SOURCE_ROOT}/rpc/greenfield-im-rpc-events.ts`,
	`${CLI_SOURCE_ROOT}/rpc/greenfield-im-rpc-session-adapter.ts`,
	`${CLI_SOURCE_ROOT}/rpc/greenfield-im-session-selection.ts`,
	`${CLI_SOURCE_ROOT}/rpc/greenfield-rpc-events.ts`,
	`${CLI_SOURCE_ROOT}/rpc/greenfield-rpc-session-adapter.ts`,
	`${CLI_SOURCE_ROOT}/rpc/runtime-host/greenfield-cli-session-assembly.ts`,
	`${CLI_SOURCE_ROOT}/rpc/runtime-host/greenfield-rpc-runtime-capabilities.ts`,
	`${CLI_SOURCE_ROOT}/rpc/runtime-host/greenfield-runtime-host-contract.ts`,
	`${CLI_SOURCE_ROOT}/rpc/runtime-host/greenfield-runtime-host.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield.ts`,
	`${ADAPTER_ROOT}/runtime-core/index.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-tool-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-sdk-active-session-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-sdk-active-session-capability-host.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-sdk-session-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-sdk-session-events.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-session-capability-host.ts`,
	`${COMPOSITION_ROOT}/greenfield-sdk-runtime-binding.ts`,
	`${COMPOSITION_ROOT}/greenfield-sdk-runtime-contract.ts`,
	`${COMPOSITION_ROOT}/greenfield-sdk-session-factory.ts`,
	`${COMPOSITION_ROOT}/greenfield-sdk-session-storage.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-command-actions-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-command-host.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-turn-executor.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-turn-retry-controller.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-action-host.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-event-host.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-contract.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-branch-navigation-host.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-resource-reload-host.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-readonly-session-manager.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-desktop-command-host.ts`,
	`${COMPOSITION_ROOT}/session-host/extension-session-host.ts`,
	`${COMPOSITION_ROOT}/greenfield-runtime-composition.ts`,
	`${COMPOSITION_ROOT}/greenfield-runtime-composition-contract.ts`,
	`${COMPOSITION_ROOT}/greenfield-conversation-path.ts`,
	`${COMPOSITION_ROOT}/greenfield-knowledge-processing-session.ts`,
	`${COMPOSITION_ROOT}/greenfield-runtime-host-session-backend.ts`,
	`${COMPOSITION_ROOT}/greenfield-runtime-host-retry.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-execution-runtime.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-peripherals.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-initialization-profile.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-initialization-transaction.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-peripheral-assembly.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-context-assembly.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-resource-index.ts`,
	`${COMPOSITION_ROOT}/greenfield-composition-resource-registry.ts`,
	`${COMPOSITION_ROOT}/greenfield-composition-shutdown.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-resource-lifecycle-assembly.ts`,
	`${COMPOSITION_ROOT}/greenfield-session-runtime-resources.ts`,
	`${COMPOSITION_ROOT}/greenfield-runtime-session-controls.ts`,
	`${COMPOSITION_ROOT}/greenfield-runtime-extension-controls.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-model-tool-order.ts`,
	`${COMPOSITION_ROOT}/greenfield-mcp-session-coordinator.ts`,
	`${COMPOSITION_ROOT}/greenfield-runtime-tool-surface.ts`,
	`${COMPOSITION_ROOT}/greenfield-tool-activation-policy.ts`,
	`${COMPOSITION_ROOT}/runtime-tools-composition.ts`,
	`${COMPOSITION_ROOT}/greenfield-subagent-profiles.ts`,
	`${COMPOSITION_ROOT}/greenfield-subagent-child.ts`,
	`${COMPOSITION_ROOT}/greenfield-child-composition-policy.ts`,
	`${COMPOSITION_ROOT}/greenfield-subagent-state-persistence.ts`,
	`${COMPOSITION_ROOT}/greenfield-subagent-runtime.ts`,
	`${COMPOSITION_ROOT}/greenfield-subagent-session-assembly.ts`,
	`${COMPOSITION_ROOT}/greenfield-turn-capability-session-assembly.ts`,
	`${COMPOSITION_ROOT}/greenfield-conversation-persistence.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-model-runtime-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-prompt-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-model-call-composer.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-model-call-message-finalizer.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-prompt-runtime.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-prompt-resource-resolver.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-agent-message-context-projector.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-conversation-context-overlay.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-compaction-extension-runtime.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-continuation-orchestrator.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-event-bridge.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-observation-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-tool-runtime.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-extension-tool-wrapper.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-hook-tool-wrapper.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-plugin-mcp-runtime.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-plugin-run-orchestrator.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-plugin-runtime-effect.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-plugin-tool-runtime.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-stop-hook-continuation-source.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-todo-continuation-source.ts`,
	`${ADAPTER_ROOT}/runtime-core/coding-agent-mcp-runtime-source.ts`,
	`${ADAPTER_ROOT}/runtime-core/coding-agent-mcp-supervisor.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-ask-user-question-runtime.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-invoke-skill-runtime.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-mcp-deferred-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-memory-controller.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-product-tools-runtime.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-sandbox-tool-adapter.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-subagent-tool-registrations.ts`,
	`${ADAPTER_ROOT}/runtime-core/greenfield-todo-runtime.ts`,
]);

const RETIRED_MIGRATION_REFERENCES = Object.freeze([
	"isPersisted",
	"Bivariant for source compatibility",
	"coding-agent-extension-compatibility",
	"assessCodingAgentExtensionCompatibility",
	"CodingAgentLegacyExtensionRuntimeCapability",
	"CodingAgentGreenfieldExtensionHostCapabilities",
	"CODING_AGENT_GREENFIELD_EXTENSION_EVENTS",
	"resolveCodingAgentGreenfieldExtensionCompatibility",
	"requiresLegacyRuntime",
	"IM_EXTENSION_EVENT_COMPATIBILITY_PROFILE",
	"GREENFIELD_EXTENSION_EVENT_PROFILE",
	"GREENFIELD_EXTENSION_HOST_CAPABILITIES",
	"bootstrap.extensionCompatibility",
	"greenfield-rpc-capabilities",
	"GreenfieldRpcBashCapability",
	"computeGreenfieldRpcSessionStats",
	"exportGreenfieldRpcConversation",
	"readGreenfieldRpcAgentMessages",
	"resolveNextGreenfieldRpcThinkingLevel",
	"greenfield-print-session-adapter",
	"GreenfieldPrintSessionAdapter",
	"greenfield-im-legacy-session-migration",
	"migrateGreenfieldImLegacySession",
	"greenfield-im-rpc-events",
	"GreenfieldImRpcEventAdapter",
	"greenfield-im-rpc-session-adapter",
	"GreenfieldImRpcSessionAdapter",
	"greenfield-im-session-selection",
	"resolveGreenfieldImSessionPath",
	"greenfield-rpc-events",
	"GreenfieldRpcEventAdapter",
	"greenfield-rpc-session-adapter",
	"GreenfieldRpcSessionAdapter",
	"greenfield-cli-session-assembly",
	"GreenfieldCliSessionAssembly",
	"createGreenfieldCliSessionAssembly",
	"greenfield-rpc-runtime-capabilities",
	"GreenfieldRpcRuntimeHostCapabilities",
	"createGreenfieldRpcRuntimeCapabilities",
	"greenfield-runtime-host-contract",
	"greenfield-runtime-host",
	"GREENFIELD_IM_EXTENSION_EVENT_PROFILE",
	"GreenfieldRpcRuntimeHostPreparation",
	"GreenfieldRpcRuntimeHostReady",
	"GreenfieldPrintRuntimeHostPreparation",
	"GreenfieldPrintRuntimeHostReady",
	"PrepareGreenfieldRuntimeHostOptions",
	"CreateGreenfieldImRuntimeHostOptions",
	"createGreenfieldImRuntimeHost",
	"prepareGreenfieldImRuntimeHost",
	"prepareGreenfieldPrintRuntimeHost",
	"prepareGreenfieldRpcRuntimeHost",
	"runGreenfieldImRuntimeHost",
	"runGreenfieldPrintRuntimeHost",
	"runGreenfieldRpcRuntimeHost",
	"adapters/runtime-core/greenfield.js",
	"adapters/runtime-core/index.js",
	"adaptCodingAgentToolRegistration",
	"LegacyCodingAgentTool",
	"greenfield-tool-adapter",
	"adapters/runtime-core/greenfield-sdk-active-session-adapter",
	"adapters/runtime-core/greenfield-sdk-active-session-capability-host",
	"adapters/runtime-core/greenfield-sdk-session-adapter",
	"adapters/runtime-core/greenfield-sdk-session-events",
	"adapters/runtime-core/greenfield-session-capability-host",
	"composition/greenfield-sdk-runtime-binding",
	"composition/greenfield-sdk-runtime-contract",
	"composition/greenfield-sdk-session-factory",
	"composition/greenfield-sdk-session-storage",
	"adapters/runtime-core/greenfield-extension-command-actions-adapter",
	"adapters/runtime-core/greenfield-extension-command-host",
	"adapters/runtime-core/greenfield-turn-executor",
	"adapters/runtime-core/greenfield-turn-retry-controller",
	"adapters/runtime-core/greenfield-extension-action-host",
	"adapters/runtime-core/greenfield-extension-event-host",
	"adapters/runtime-core/greenfield-extension-contract",
	"adapters/runtime-core/greenfield-branch-navigation-host",
	"adapters/runtime-core/greenfield-resource-reload-host",
	"adapters/runtime-core/greenfield-readonly-session-manager",
	"adapters/runtime-core/greenfield-desktop-command-host",
	"composition/session-host/extension-session-host",
	"greenfield-runtime-composition",
	"createGreenfieldRuntimeComposition",
	"GreenfieldRuntimeComposition",
	"GreenfieldRuntimeCompositionOptions",
	"GreenfieldRuntimeContextOptions",
	"GreenfieldRuntimeConversationOptions",
	"GreenfieldRuntimeEnvironmentOptions",
	"GreenfieldRuntimeExtensionControls",
	"GreenfieldRuntimeExtensionOptions",
	"GreenfieldRuntimeModelOptions",
	"GreenfieldRuntimeObservabilityOptions",
	"GreenfieldRuntimePluginOptions",
	"GreenfieldRuntimePromptOptions",
	"GreenfieldRuntimeSessionControls",
	"GreenfieldRuntimeSessionHookLifecycle",
	"GreenfieldRuntimeSessionOptions",
	"GreenfieldRuntimeSubagentOptions",
	"GreenfieldRuntimeToolAccess",
	"GreenfieldRuntimeToolOptions",
	"GreenfieldInitialTodoLockSource",
	"greenfield-conversation-path",
	"resolveGreenfieldSessionIdFromPath",
	"greenfield-knowledge-processing-session",
	"createGreenfieldKnowledgeProcessingSessionFactory",
	"GreenfieldKnowledgeProcessingSessionFactoryOptions",
	"greenfield-runtime-host-session-backend",
	"GreenfieldRuntimeHostSessionBackend",
	"GreenfieldRuntimeHostSessionBackendOptions",
	"greenfield-runtime-host-retry",
	"GreenfieldRuntimeHostRetrySettings",
	"withGreenfieldRuntimeHostRetry",
	"greenfield-session-execution-runtime",
	"GreenfieldSessionExecutionRuntime",
	"GreenfieldSessionExecutionRuntimeOptions",
	"greenfield-session-peripherals",
	"GreenfieldAgentPluginReconfiguration",
	"GreenfieldSessionConfigurationState",
	"GreenfieldSubagentWorkRuntime",
	"GreenfieldBackgroundWorkController",
	"greenfield-session-initialization-profile",
	"GreenfieldSessionInitializationProfile",
	"createGreenfieldSessionInitializationProfile",
	"greenfield-session-initialization-transaction",
	"GreenfieldSessionInitializationRegistry",
	"GreenfieldSessionInitializationTransactionOptions",
	"GreenfieldSessionInitializationTransaction",
	"createGreenfieldSessionInitializationTransaction",
	"greenfield-session-peripheral-assembly",
	"GreenfieldSessionPeripheralAssemblyOptions",
	"GreenfieldSessionPeripheralAssembly",
	"createGreenfieldSessionPeripheralAssembly",
	"greenfield-session-context-assembly",
	"GreenfieldSessionContextAssemblyOptions",
	"GreenfieldSessionContextAssembly",
	"createGreenfieldSessionContextAssembly",
	"greenfield-session-resource-index",
	"GreenfieldSessionValueIndex",
	"InMemoryGreenfieldSessionValueIndex",
	"GreenfieldSessionMarkerIndex",
	"InMemoryGreenfieldSessionMarkerIndex",
	"greenfield-composition-resource-registry",
	"GreenfieldCompositionResourceCleanupRegistry",
	"GreenfieldCompositionResourceRegistry",
	"greenfield-composition-shutdown",
	"GreenfieldCompositionShutdown",
	"createGreenfieldCompositionShutdown",
	"greenfield-session-resource-lifecycle-assembly",
	"GreenfieldSessionResourceLifecycle",
	"createGreenfieldSessionResourceLifecycleAssembly",
	"greenfield-session-runtime-resources",
	"GreenfieldSessionRuntimeResourcesOptions",
	"createGreenfieldSessionRuntimeResources",
	"greenfield-runtime-session-controls",
	"createGreenfieldRuntimeSessionControls",
	"greenfield-runtime-extension-controls",
	"createGreenfieldRuntimeExtensionControls",
	"greenfield-model-tool-order",
	"greenfield-mcp-session-coordinator",
	"GreenfieldMcpSessionIndexes",
	"GreenfieldMcpSessionCoordinatorOptions",
	"GreenfieldMcpSessionControllerOptions",
	"GreenfieldMcpSessionCoordinator",
	"createGreenfieldMcpSessionCoordinator",
	"greenfield-runtime-tool-surface",
	"GreenfieldRuntimeToolSurfaceIndexes",
	"GreenfieldRuntimeToolSurfaceOptions",
	"GreenfieldRuntimeToolSurface",
	"createGreenfieldRuntimeToolSurface",
	"greenfield-tool-activation-policy",
	"GreenfieldToolAvailability",
	"resolveGreenfieldToolActivation",
	"isGreenfieldKnowledgeToolEnabled",
	"composition/runtime-tools-composition",
	"greenfield-subagent-profiles",
	"GREENFIELD_SUBAGENT_TYPE_EXPLORER",
	"GREENFIELD_SUBAGENT_TYPE_WORKFLOW",
	"GreenfieldSubagentProfile",
	"createDefaultGreenfieldSubagentTypeRegistry",
	"greenfield-subagent-child",
	"GreenfieldSubagentChildHandleOptions",
	"createGreenfieldSubagentChildHandle",
	"greenfield-child-composition-policy",
	"GreenfieldChildRuntimeCompositionFactory",
	"GreenfieldChildCompositionFactoryOptions",
	"createGreenfieldChildCompositionFactory",
	"greenfield-subagent-state-persistence",
	"GREENFIELD_SUBAGENT_STATE_CUSTOM_TYPE",
	"GreenfieldSubagentStatePersistenceOptions",
	"GreenfieldSubagentStatePersistence",
	"greenfield-subagent-runtime",
	"GreenfieldSubagentRuntimeOptions",
	"GreenfieldSubagentRuntime",
	"greenfield-subagent-session-assembly",
	"GreenfieldSubagentChildSessionOptions",
	"GreenfieldSubagentChildCompositionRequest",
	"GreenfieldSubagentChildComposition",
	"GreenfieldSubagentSessionAssemblyOptions",
	"GreenfieldSubagentChildFactoryContext",
	"GreenfieldSubagentChildFactory",
	"createGreenfieldSubagentSessionAssembly",
	"greenfield-turn-capability-session-assembly",
	"GreenfieldTurnCapabilitySessionIdentity",
	"GreenfieldTurnCapabilityActivationPort",
	"GreenfieldTurnCapabilityPromptOptions",
	"GreenfieldTurnCapabilitySessionAssemblyOptions",
	"GreenfieldTurnCapabilitySessionAssembly",
	"createGreenfieldTurnCapabilitySessionAssembly",
	"greenfield-conversation-persistence",
	"GreenfieldConversationPersistence",
	"GreenfieldConversationPersistenceFactoryContext",
	"GreenfieldConversationPersistenceFactory",
	"createFileGreenfieldConversationPersistence",
	"createInMemoryGreenfieldConversationPersistence",
	"resolveGreenfieldConversationPersistence",
	"greenfield-model-runtime-adapter",
	"greenfield-prompt-adapter",
	"greenfield-model-call-composer",
	"greenfield-model-call-message-finalizer",
	"greenfield-prompt-runtime",
	"greenfield-prompt-resource-resolver",
	"greenfield-agent-message-context-projector",
	"greenfield-conversation-context-overlay",
	"CodingAgentGreenfieldPromptAdapter",
	"CodingAgentGreenfieldModelCallMessageFinalizer",
	"CodingAgentGreenfieldAgentMessageContextProjector",
	"CodingAgentGreenfieldConversationContextOverlay",
	"projectCodingAgentGreenfieldMessages",
	"GreenfieldPromptAdapter",
	"GreenfieldPromptPreparationContext",
	"GreenfieldPreparedPrompt",
	"GreenfieldPromptInterceptionResult",
	"GreenfieldHandledPromptResult",
	"GreenfieldPromptResult",
	"adapters/runtime-core/greenfield-compaction-extension-runtime",
	"adapters/runtime-core/greenfield-continuation-orchestrator",
	"adapters/runtime-core/greenfield-extension-event-bridge",
	"adapters/runtime-core/greenfield-extension-observation-adapter",
	"adapters/runtime-core/greenfield-extension-tool-runtime",
	"adapters/runtime-core/greenfield-extension-tool-wrapper",
	"adapters/runtime-core/greenfield-hook-tool-wrapper",
	"adapters/runtime-core/greenfield-plugin-mcp-runtime",
	"adapters/runtime-core/greenfield-plugin-run-orchestrator",
	"adapters/runtime-core/greenfield-plugin-runtime-effect",
	"adapters/runtime-core/greenfield-plugin-tool-runtime",
	"adapters/runtime-core/greenfield-stop-hook-continuation-source",
	"adapters/runtime-core/greenfield-todo-continuation-source",
	"adapters/runtime-core/coding-agent-mcp-runtime-source",
	"adapters/runtime-core/coding-agent-mcp-supervisor",
	"adapters/runtime-core/greenfield-ask-user-question-runtime",
	"adapters/runtime-core/greenfield-invoke-skill-runtime",
	"adapters/runtime-core/greenfield-mcp-deferred-adapter",
	"adapters/runtime-core/greenfield-memory-controller",
	"adapters/runtime-core/greenfield-product-tools-runtime",
	"adapters/runtime-core/greenfield-sandbox-tool-adapter",
	"adapters/runtime-core/greenfield-subagent-tool-registrations",
	"adapters/runtime-core/greenfield-todo-runtime",
	"CodingAgentGreenfieldMemoryController",
	"CodingAgentGreenfieldProductToolFeatureOptions",
	"CodingAgentGreenfieldProductToolOptions",
	"CodingAgentGreenfieldSandboxToolsOptions",
	"createCodingAgentAskUserQuestionRuntimeFeature",
	"createCodingAgentGreenfieldProductToolFeature",
	"createCodingAgentGreenfieldProductToolRegistrations",
	"createCodingAgentGreenfieldSandboxToolRegistrations",
	"createCodingAgentInvokeSkillRuntimeFeature",
	"CodingAgentGreenfieldExtensionRunnerPort",
	"CodingAgentGreenfieldExtensionToolSource",
	"CodingAgentGreenfieldSessionToolRegistration",
	"CodingAgentGreenfieldExtensionEventBinding",
	"CodingAgentGreenfieldExtensionEventBridge",
	"CodingAgentGreenfieldExtensionObservationAdapter",
	"CodingAgentGreenfieldExtensionToolRuntime",
	"CodingAgentGreenfieldObservedExtensionEvent",
	"CodingAgentGreenfieldExtensionToolSurface",
]);

export function collectCodingAgentMigrationResidue(files) {
	const sourceFiles = files.filter(
		(file) => file.path.startsWith(`${SOURCE_ROOT}/`) || file.path.startsWith(`${CLI_SOURCE_ROOT}/`),
	);
	const productRuntimeFiles = files.filter(
		(file) =>
			file.path.startsWith(`${SOURCE_ROOT}/`) ||
			file.path.startsWith(`${CLI_SOURCE_ROOT}/`) ||
			file.path.startsWith(`${RUNTIME_CORE_SOURCE_ROOT}/`) ||
			file.path.startsWith(`${RUNTIME_STORAGE_SOURCE_ROOT}/`) ||
			file.path.startsWith(`${DESKTOP_SOURCE_ROOT}/`),
	);
	const runtimeCoreFiles = files.filter((file) => file.path.startsWith(`${RUNTIME_CORE_SOURCE_ROOT}/`));
	const adapterFiles = sourceFiles.filter((file) => file.path.startsWith(`${ADAPTER_ROOT}/`));
	const cliFiles = sourceFiles.filter((file) => file.path.startsWith(`${CLI_SOURCE_ROOT}/`));
	const compositionFiles = sourceFiles.filter((file) => file.path.startsWith(`${COMPOSITION_ROOT}/`));
	const hostExtensionFiles = sourceFiles.filter((file) => file.path.startsWith(`${HOST_EXTENSION_ROOT}/`));
	const desktopFiles = files.filter((file) => file.path.startsWith(`${DESKTOP_SOURCE_ROOT}/`));
	const cliTestFiles = files.filter((file) => file.path.startsWith(`${CLI_TEST_ROOT}/`));
	const sdkSessionBoundaryFiles = files.filter(
		(file) =>
			file.path.startsWith(`${SDK_SESSION_HOST_ROOT}/`) ||
			file.path.startsWith(`${SOURCE_ROOT}/host/coding-agent-sdk-`) ||
			file.path.startsWith(`${SDK_PUBLIC_API_ROOT}/`) ||
			file.path === SDK_RUNTIME_PUBLIC_API ||
			file.path.startsWith(`${SDK_TEST_ROOT}/`),
	);
	return Object.freeze({
		retiredFiles: RETIRED_MIGRATION_FILES.filter((path) => sourceFiles.some((file) => file.path === path)),
		retiredReferences: files.flatMap((file) =>
			RETIRED_MIGRATION_REFERENCES.filter((reference) => containsRetiredReference(file.text, reference)).map(
				(reference) => ({
					path: file.path,
					reference,
				}),
			),
		),
		adapterGreenfieldFiles: adapterFiles.filter(
			(file) => basename(file.path).startsWith("greenfield") && !RETIRED_MIGRATION_FILES.includes(file.path),
		),
		cliGreenfieldFiles: cliFiles.filter((file) => basename(file.path).startsWith("greenfield")),
		compositionGreenfieldFiles: compositionFiles.filter((file) => basename(file.path).startsWith("greenfield")),
		adapterCompositionEdgeFiles: adapterFiles.filter((file) =>
			collectModuleSpecifiers(file.text).some((specifier) => specifier.includes("composition/")),
		),
		compositionPublicApiEdgeFiles: compositionFiles.filter((file) =>
			collectModuleSpecifiers(file.text).some((specifier) => specifier.includes("public-api/")),
		),
		hostExtensionCompositionEdgeFiles: hostExtensionFiles.filter((file) =>
			collectModuleSpecifiers(file.text).some((specifier) => specifier.includes("composition/")),
		),
		sdkSessionMigrationIdentities: sdkSessionBoundaryFiles.flatMap((file) =>
			[...new Set(file.text.match(SDK_SESSION_MIGRATION_IDENTITY_PATTERN) ?? [])].map((identity) => ({
				path: file.path,
				identity,
			})),
		),
		sdkSessionMigrationFiles: sdkSessionBoundaryFiles.filter((file) => basename(file.path).startsWith("greenfield")),
		desktopRuntimeMigrationFiles: desktopFiles.filter(
			(file) =>
				file.path.startsWith(`${RETIRED_DESKTOP_RUNTIME_ROOT}/`) ||
				basename(file.path).startsWith("desktop-greenfield-") ||
				basename(file.path).includes("-differential."),
		),
		desktopRuntimeMigrationIdentities: desktopFiles.flatMap((file) =>
			[...new Set(file.text.match(DESKTOP_RUNTIME_MIGRATION_IDENTITY_PATTERN) ?? [])].map((identity) => ({
				path: file.path,
				identity,
			})),
		),
		desktopRuntimeSourceImportFiles: desktopFiles.filter((file) =>
			collectModuleSpecifiers(file.text).some((specifier) =>
				/^(?:\.\.\/)+runtime-[^/]+\/src(?:\/|$)/.test(specifier),
			),
		),
		cliRuntimeTestMigrationFiles: cliTestFiles.filter(
			(file) =>
				basename(file.path).startsWith("greenfield-") ||
				basename(file.path).includes("-differential.") ||
				basename(file.path) === "legacy-session-resource-close.test.ts" ||
				basename(file.path) === "legacy-session-fallback-narrowing.test.ts",
		),
		cliRuntimeTestMigrationIdentities: cliTestFiles.flatMap((file) =>
			[...new Set(file.text.match(CLI_RUNTIME_TEST_MIGRATION_IDENTITY_PATTERN) ?? [])].map((identity) => ({
				path: file.path,
				identity,
			})),
		),
		cliHistoricalOracleProductionReferences: sourceFiles.flatMap((file) =>
			CLI_HISTORICAL_ORACLE_REFERENCES.filter((reference) => file.text.includes(reference)).map((reference) => ({
				path: file.path,
				reference,
			})),
		),
		runtimeContractMissingFilters: collectRuntimeContractMissingFilters(files),
		runtimeCutoverScriptReferences: files
			.filter(
				(file) => RUNTIME_CONTRACT_CONFIG_FILES.includes(file.path) && file.text.includes("verify:runtime-cutover"),
			)
			.map((file) => ({ path: file.path })),
		runtimeCoreMigrationFiles: runtimeCoreFiles.filter((file) => basename(file.path).startsWith("greenfield-")),
		productRuntimeMigrationIdentities: productRuntimeFiles.flatMap((file) =>
			[...new Set(file.text.match(PRODUCT_RUNTIME_MIGRATION_IDENTITY_PATTERN) ?? [])].map((identity) => ({
				path: file.path,
				identity,
			})),
		),
		codingAgentGreenfieldTestFiles: files.filter(
			(file) =>
				file.path.startsWith(`${TEST_ROOT}/`) &&
				!file.path.startsWith(`${SDK_TEST_ROOT}/`) &&
				basename(file.path).startsWith("greenfield-"),
		),
		unclassifiedProductionGreenfieldOccurrences: productRuntimeFiles
			.filter((file) => !isAlreadyClassifiedMigrationResidue(file))
			.flatMap(collectUnclassifiedProductionGreenfieldOccurrences),
		sourceCompatibilityShimReferences: productRuntimeFiles.flatMap((file) =>
			["isPersisted", "Bivariant for source compatibility"]
				.filter((reference) => file.text.includes(reference))
				.map((reference) => ({ path: file.path, reference })),
		),
		retiredInfrastructureFiles: RETIRED_INFRASTRUCTURE_FILES.filter((path) =>
			files.some((file) => file.path === path),
		).map((path) => ({ path })),
		runtimeAdapterUtilityBackedgeFiles: adapterFiles.filter((file) =>
			collectModuleSpecifiers(file.text).some((specifier) => specifier.includes("/utils/")),
		),
		legacyInfrastructureAdapterLabels: sourceFiles.flatMap((file) =>
			LEGACY_INFRASTRUCTURE_ADAPTER_LABELS.filter((label) => file.text.includes(label)).map((label) => ({
				path: file.path,
				label,
			})),
		),
	});
}

export function findCodingAgentMigrationResidueViolations(state) {
	const violations = [];
	for (const path of state.retiredFiles) violations.push(`${path}: retired migration file must stay deleted`);
	for (const reference of state.retiredReferences) {
		violations.push(`${reference.path}: retired migration reference (${reference.reference})`);
	}
	for (const reference of state.sdkSessionMigrationIdentities) {
		violations.push(`${reference.path}: retired SDK Session migration identity (${reference.identity})`);
	}
	for (const file of state.sdkSessionMigrationFiles) {
		violations.push(`${file.path}: retired SDK Session migration filename`);
	}
	for (const key of Object.keys(MIGRATION_RESIDUE_LIMITS)) {
		const actual = state[key].length;
		const limit = MIGRATION_RESIDUE_LIMITS[key];
		if (actual > limit) violations.push(`${key}: ${actual} exceeds migration residue limit ${limit}`);
	}
	return violations;
}

function containsRetiredReference(text, reference) {
	return /^[A-Za-z_$][\w$]*$/.test(reference) ? new RegExp(`\\b${reference}\\b`).test(text) : text.includes(reference);
}

function collectUnclassifiedProductionGreenfieldOccurrences(file) {
	return [...file.text.matchAll(/greenfield/gi)].map((match) => ({
		path: file.path,
		index: match.index ?? 0,
	}));
}

function isAlreadyClassifiedMigrationResidue(file) {
	return (
		basename(file.path).toLowerCase().includes("greenfield") ||
		RETIRED_MIGRATION_FILES.includes(file.path) ||
		RETIRED_MIGRATION_REFERENCES.some((reference) => containsRetiredReference(file.text, reference)) ||
		(file.text.match(SDK_SESSION_MIGRATION_IDENTITY_PATTERN) ?? []).length > 0 ||
		(file.text.match(DESKTOP_RUNTIME_MIGRATION_IDENTITY_PATTERN) ?? []).length > 0 ||
		(file.text.match(PRODUCT_RUNTIME_MIGRATION_IDENTITY_PATTERN) ?? []).length > 0
	);
}

function collectModuleSpecifiers(text) {
	const specifiers = [];
	const pattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
	for (const match of text.matchAll(pattern)) specifiers.push(match[1]);
	return specifiers;
}

function collectRuntimeContractMissingFilters(files) {
	const cliPackage = files.find((file) => file.path === "packages/cli-app/package.json");
	if (!cliPackage) return [];
	const script = readPackageScript(cliPackage.text, "verify:runtime-contract");
	return RUNTIME_CONTRACT_REQUIRED_FILTERS.filter((filter) => !script?.includes(filter)).map((filter) => ({
		path: cliPackage.path,
		filter,
	}));
}

function readPackageScript(text, name) {
	try {
		const packageJson = JSON.parse(text);
		if (typeof packageJson !== "object" || packageJson === null) return undefined;
		const scripts = packageJson.scripts;
		if (typeof scripts !== "object" || scripts === null) return undefined;
		const script = scripts[name];
		return typeof script === "string" ? script : undefined;
	} catch {
		return undefined;
	}
}

function readCurrentFiles() {
	const sourceFiles = [
		SOURCE_ROOT,
		TEST_ROOT,
		CLI_SOURCE_ROOT,
		CLI_TEST_ROOT,
		RUNTIME_CORE_SOURCE_ROOT,
		RUNTIME_STORAGE_SOURCE_ROOT,
		DESKTOP_SOURCE_ROOT,
	].flatMap((root) =>
		walkFiles(join(repoRoot, root), { extensions: [".ts"] }).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
	);
	const configFiles = RUNTIME_CONTRACT_CONFIG_FILES.map((path) => ({
		path,
		text: readText(join(repoRoot, path)),
	}));
	return [...sourceFiles, ...configFiles];
}

if (isDirectRun(import.meta.url)) {
	const missingRoots = [
		SOURCE_ROOT,
		TEST_ROOT,
		CLI_SOURCE_ROOT,
		CLI_TEST_ROOT,
		RUNTIME_CORE_SOURCE_ROOT,
		RUNTIME_STORAGE_SOURCE_ROOT,
		ADAPTER_ROOT,
		COMPOSITION_ROOT,
		HOST_EXTENSION_ROOT,
		SDK_SESSION_HOST_ROOT,
		SDK_PUBLIC_API_ROOT,
		SDK_TEST_ROOT,
		DESKTOP_MAIN_ROOT,
		DESKTOP_AGENT_RUNTIME_ROOT,
	].filter((path) => !existsSync(join(repoRoot, path)));
	if (missingRoots.length > 0) {
		for (const path of missingRoots) fail(`[coding-agent-migration-residue] missing source root (${path})`);
	} else {
		const state = collectCodingAgentMigrationResidue(readCurrentFiles());
		const violations = findCodingAgentMigrationResidueViolations(state);
		if (violations.length > 0) {
			for (const violation of violations) fail(`[coding-agent-migration-residue] ${violation}`);
		} else {
			ok(
				`[coding-agent-migration-residue] ok (retired files=${state.retiredFiles.length}/0, retired references=${state.retiredReferences.length}/0, SDK Session migration identities=${state.sdkSessionMigrationIdentities.length}/0, filenames=${state.sdkSessionMigrationFiles.length}/0, Desktop Runtime migration files=${state.desktopRuntimeMigrationFiles.length}/0, identities=${state.desktopRuntimeMigrationIdentities.length}/0, Runtime source imports=${state.desktopRuntimeSourceImportFiles.length}/0, CLI Runtime test migration files=${state.cliRuntimeTestMigrationFiles.length}/0, identities=${state.cliRuntimeTestMigrationIdentities.length}/0, historical Oracle production references=${state.cliHistoricalOracleProductionReferences.length}/0, runtime contract missing filters=${state.runtimeContractMissingFilters.length}/0, cutover script references=${state.runtimeCutoverScriptReferences.length}/0, Runtime Core migration files=${state.runtimeCoreMigrationFiles.length}/0, product Runtime migration identities=${state.productRuntimeMigrationIdentities.length}/0, Coding Agent Greenfield test files=${state.codingAgentGreenfieldTestFiles.length}/0, unclassified production Greenfield occurrences=${state.unclassifiedProductionGreenfieldOccurrences.length}/0, source compatibility shim references=${state.sourceCompatibilityShimReferences.length}/0, retired infrastructure files=${state.retiredInfrastructureFiles.length}/0, Runtime Adapter utility backedges=${state.runtimeAdapterUtilityBackedgeFiles.length}/0, legacy infrastructure Adapter labels=${state.legacyInfrastructureAdapterLabels.length}/0, Adapter greenfield files=${state.adapterGreenfieldFiles.length}/${MIGRATION_RESIDUE_LIMITS.adapterGreenfieldFiles}, CLI greenfield files=${state.cliGreenfieldFiles.length}/${MIGRATION_RESIDUE_LIMITS.cliGreenfieldFiles}, Composition greenfield files=${state.compositionGreenfieldFiles.length}/${MIGRATION_RESIDUE_LIMITS.compositionGreenfieldFiles}, Adapter->Composition edge files=${state.adapterCompositionEdgeFiles.length}/${MIGRATION_RESIDUE_LIMITS.adapterCompositionEdgeFiles}, Composition->public API edge files=${state.compositionPublicApiEdgeFiles.length}/${MIGRATION_RESIDUE_LIMITS.compositionPublicApiEdgeFiles}, Extension Host->Composition edge files=${state.hostExtensionCompositionEdgeFiles.length}/${MIGRATION_RESIDUE_LIMITS.hostExtensionCompositionEdgeFiles})`,
			);
		}
	}
}
