import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { buildDefaultHookConfigLayers } from "@vetta/ecosystem-adapter";
import {
	SessionExtensionFunctionRegistry,
	type SessionExtensionFunctionSource,
} from "@vetta/runtime-core/session-extensions";
import { createMcpToolResultPolicy, EMPTY_MCP_CONFIG_SOURCE, type McpServerSupervisor } from "@vetta/runtime-mcp";
import { nodeModelInputImageProcessor, nodeWorkspaceFactsFileSource } from "@vetta/runtime-node/coding";
import {
	createNodeHtmlExportFileAdapters,
	createNodeKnowledgeRuntime,
	createNodeResultArtifactStorage,
	NodeTextFileStorage,
	NodeTransactionalTextStorage,
	nodeConfigurationValueResolver,
	nodeSyncTextFileSource,
} from "@vetta/runtime-node/host";
import { createNodeMcpSupervisor } from "@vetta/runtime-node/mcp";
import { createLangfuseRuntimeTracerFromEnv } from "@vetta/runtime-telemetry/langfuse";
import { createCodingAgentCompactionExtensionRuntime } from "../../adapters/extensions/compaction-extension-adapter.js";
import { createCodingAgentAuthRuntime } from "../../auth/index.js";
import { createCodingAgentMemoryRolloverRuntime } from "../../composition/memory-runtime.js";
import { createCodingAgentHtmlExportRuntime } from "../../export-html/index.js";
import { CODING_AGENT_ASK_USER_QUESTION_FUNCTION } from "../../features/ask-user-question/contracts.js";
import { CONFIG_DIR_NAME, DEFAULT_SERVER_URL, ENV_SERVER_URL } from "../../identity.js";
import { createCodingAgentMcpRuntimeToolSource } from "../../mcp/runtime/tool-source.js";
import { detectWorkspaceFacts, probeWorkspaceSignals } from "../../model-context/workspace-facts.js";
import { createCodingAgentModelRuntime } from "../../models/index.js";
import { createCodingAgentPluginMcpRuntime } from "../../plugins/runtime/mcp-runtime.js";
import type { CodingAgentSessionStorageTarget, CreateCodingAgentSessionOptions } from "../../public-api/sdk/index.js";
import { parseCodingAgentLegacySessionDocument } from "../../sessions/legacy/document.js";
import { createCodingAgentCodingToolResultPolicy } from "../../tool-results/result-policy.js";
import { CodingAgentSdkExtensionTransitionAdapter } from "../coding-agent-sdk-extension-transition-adapter.js";
import { CodingAgentSdkResourceSourceAdapter } from "../coding-agent-sdk-resource-source-adapter.js";
import { resolveCodingAgentSessionDir } from "../coding-agent-session-storage.js";
import { createCodingAgentExtensionEventHost } from "../extensions/event-host.js";
import { getAgentDir, getExportTemplateDir, getKnowledgeDir, getVettaHomePath, VERSION } from "../node-config.js";
import { createCodingAgentNodeSettingsRuntime } from "../node-state-services.js";
import { createCodingAgentNodeSessionExecutionEnvironment } from "../tool-environment/node/node-session-execution-environment.js";
import { createCodingAgentNodeToolEnvironment } from "../tool-environment/node/node-tool-environment.js";
import type { CodingAgentSdkPublicHostContext, CodingAgentSdkSessionCompositionResult } from "./contracts.js";
import { adaptPublicCodingAgentSdkCustomTools, resolvePublicSdkActiveToolNames } from "./custom-tool-adapter.js";
import { resolveSdkInitialModel } from "./initial-model.js";
import { nodeCodingAgentSdkSessionIdentityRuntime } from "./node-session-identity-runtime.js";
import { createCodingAgentSdkSessionResourceRuntime } from "./resource-runtime.js";
import { type CodingAgentSdkOwnedResource, createCodingAgentSdkSession } from "./runtime-factory.js";
import {
	createCodingAgentSdkActiveSessionCapabilityHostFactory,
	createCodingAgentSdkSessionCapabilityHostFactory,
} from "./session-capability-hosts.js";

/** Compatibility Node Composition Root for the zero-configuration public SDK. */
export async function createNodeCodingAgentSdkSessionComposition(
	options: CreateCodingAgentSessionOptions = {},
	hostContext: CodingAgentSdkPublicHostContext = {},
): Promise<CodingAgentSdkSessionCompositionResult> {
	let resourceSourceAdapter: CodingAgentSdkResourceSourceAdapter | undefined;
	try {
		resourceSourceAdapter = await CodingAgentSdkResourceSourceAdapter.create({
			cwd: options.cwd ?? process.cwd(),
			resources: options.resources,
			skillSources: options.skillSources,
			extensionSources: options.extensionSources,
		});
		return await createCodingAgentSdkSessionComposition(
			options,
			hostContext,
			resourceSourceAdapter,
			hostContext.onSessionClosed,
		);
	} catch (error) {
		if (resourceSourceAdapter) {
			try {
				await resourceSourceAdapter.dispose();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "Public SDK Session creation and resource cleanup failed");
			}
		}
		throw error;
	}
}

async function createCodingAgentSdkSessionComposition(
	options: CreateCodingAgentSessionOptions,
	hostContext: CodingAgentSdkPublicHostContext,
	resourceSourceAdapter?: CodingAgentSdkResourceSourceAdapter,
	onSessionClosed?: () => void,
): Promise<CodingAgentSdkSessionCompositionResult> {
	const sessionTools = adaptPublicCodingAgentSdkCustomTools(options.customTools);
	const activeToolNames = resolvePublicSdkActiveToolNames(options.activeTools);
	const activation =
		activeToolNames === undefined
			? undefined
			: {
					mode: "explicit" as const,
					toolNames: [...activeToolNames],
				};
	const cwd = options.cwd ?? process.cwd();
	const workspaceFacts = detectWorkspaceFacts(cwd, (root) =>
		probeWorkspaceSignals(root, nodeWorkspaceFactsFileSource),
	);
	const agentDir = options.agentDir ?? getAgentDir();
	const authPath = join(agentDir, "auth.json");
	const modelsPath = join(agentDir, "models.json");
	const authStorage =
		hostContext.authStorage ??
		createCodingAgentAuthRuntime(new NodeTransactionalTextStorage(authPath), {
			configurationValueResolver: nodeConfigurationValueResolver,
		});
	const htmlExporter =
		hostContext.htmlExporter ??
		createCodingAgentHtmlExportRuntime(
			createNodeHtmlExportFileAdapters({
				templateDirectory: getExportTemplateDir(),
				readLegacySession: (path) => parseCodingAgentLegacySessionDocument(nodeSyncTextFileSource.read(path)),
			}),
		);
	const modelRegistry =
		hostContext.modelRegistry ??
		createCodingAgentModelRuntime(authStorage, {
			modelsJsonPath: modelsPath,
			configFileSource: nodeSyncTextFileSource,
			configurationValueResolver: nodeConfigurationValueResolver,
		});
	const settingsManager = hostContext.settingsManager ?? createCodingAgentNodeSettingsRuntime(cwd, agentDir);
	const resultArtifacts = createNodeResultArtifactStorage({
		codingRoot: join(agentDir, "tool-results"),
		mcpRoot: join(agentDir, "mcp-results"),
	});
	const mcpToolResultPolicy = createMcpToolResultPolicy({ artifactStore: resultArtifacts.mcp });

	if (!hostContext.modelRegistry) {
		let serverUrl = options.serverUrl ?? process.env[ENV_SERVER_URL] ?? settingsManager.getServerUrl();
		if (!serverUrl) {
			serverUrl = DEFAULT_SERVER_URL;
			if (options.serverUrl === undefined) settingsManager.setServerUrl(serverUrl);
		}
		modelRegistry.setServerUrl(serverUrl);
		modelRegistry.setServerToken(settingsManager.getServerToken());
		modelRegistry.setServerTokenGetter(() => settingsManager.getServerTokenFresh());
		await modelRegistry.loadRemoteModels();
	}

	const promptTemplateContributions = options.resources?.promptTemplates;
	const contextFileContributions = options.resources?.contextFiles;
	let currentAgentPlugins = options.agentPlugins;
	const resourceLoader = createCodingAgentSdkSessionResourceRuntime({
		cwd,
		agentDir,
		settings: settingsManager,
		additionalExtensionPaths: resourceSourceAdapter?.readExtensionPaths()
			? [...resourceSourceAdapter.readExtensionPaths()]
			: [],
		appendSystemPrompt: options.appendSystemPrompt,
		includeAgentSkills: options.includeAgentSkills,
		additionalSkillPaths: [
			...(currentAgentPlugins?.skillPathContributions?.flatMap((contribution) => contribution.paths) ?? []),
			...(resourceSourceAdapter?.readSkillPaths() ?? options.resources?.skillPaths ?? []),
		],
		additionalPromptTemplatePaths: options.resources?.promptTemplatePaths
			? [...options.resources.promptTemplatePaths]
			: [],
		systemPrompt: options.resources?.systemPrompt,
		skillsOverride: resourceSourceAdapter ? (base) => resourceSourceAdapter.transformSkills(base) : undefined,
		promptsOverride: promptTemplateContributions
			? (base) => ({
					diagnostics: base.diagnostics,
					prompts: [
						...base.prompts,
						...promptTemplateContributions.map((template) => ({
							name: template.name,
							description: template.description,
							content: template.content,
							source: "sdk",
							filePath: template.filePath ?? join(cwd, ".vetta", "sdk-prompts", `${template.name}.md`),
						})),
					],
				})
			: undefined,
		agentsFilesOverride: contextFileContributions
			? (base) => ({
					agentsFiles: [...base.agentsFiles, ...contextFileContributions.map((file) => ({ ...file }))],
				})
			: undefined,
	});
	await resourceLoader.reload();
	const extensionsResult = resourceLoader.getExtensions();
	const storage: CodingAgentSessionStorageTarget = options.storage ?? {
		kind: "file-create",
		conversationDir: resolveCodingAgentSessionDir(cwd, undefined, agentDir),
	};
	const initial = await resolveSdkInitialModel(options, modelRegistry, settingsManager);
	const tracer = options.tracer ?? createLangfuseRuntimeTracerFromEnv();
	const mcpEnabled = options.enableMcp !== false;
	const mcpDebug = settingsManager.getMcpDebug();
	const managedMcpSource = mcpEnabled
		? await createCodingAgentMcpRuntimeToolSource({
				supervisor: createSdkMcpSupervisor({ cwd, agentDir, debug: mcpDebug }),
				resultPolicy: mcpToolResultPolicy,
			})
		: undefined;
	const sessionFunctions = createSdkSessionFunctionSource(options);
	const ownedResources: CodingAgentSdkOwnedResource[] = [
		...(resourceSourceAdapter ? [resourceSourceAdapter] : []),
		...(managedMcpSource ? [{ id: "sdk-mcp-source", dispose: () => managedMcpSource.dispose() }] : []),
		...(sessionFunctions ? [{ id: "sdk-session-functions", dispose: () => sessionFunctions.dispose() }] : []),
	];
	const extensionTransitions = new CodingAgentSdkExtensionTransitionAdapter((session, composition, bindingOptions) => {
		const currentExtensions = resourceLoader.getExtensions();
		return createCodingAgentExtensionEventHost({
			extensions: currentExtensions.extensions,
			runtime: currentExtensions.runtime,
			cwd,
			session,
			modelRegistry,
			resourceLoader,
			bindEvents: (runner, bindOptions) =>
				composition.bindExtensionRunner(session.sessionId, runner, {
					replaceExisting: bindingOptions?.replaceExisting ?? bindOptions?.replaceExisting,
				}),
		});
	});
	const capabilityFactoryOptions = {
		sdkOptions: options,
		cwd,
		settingsManager,
		modelRegistry,
		resourceLoader,
		resourceSourceAdapter,
		extensionTransitions,
		htmlExporter,
		readAgentPlugins: () => currentAgentPlugins,
		setAgentPlugins: (agentPlugins: CreateCodingAgentSessionOptions["agentPlugins"]) => {
			currentAgentPlugins = agentPlugins;
		},
	};

	const created = await createCodingAgentSdkSession({
		storage,
		identityRuntime: hostContext.identityRuntime ?? nodeCodingAgentSdkSessionIdentityRuntime,
		sessionArtifactCleaner: resultArtifacts.cleaner,
		ownedResources,
		composition: {
			createToolEnvironment: createCodingAgentNodeToolEnvironment,
			createSessionExecutionEnvironment: createCodingAgentNodeSessionExecutionEnvironment,
			codingToolResultPolicy: createCodingAgentCodingToolResultPolicy({ artifactStore: resultArtifacts.coding }),
			ocrMaxConcurrent: resolvePositiveInteger(process.env.VETTA_KB_OCR_CONCURRENCY),
			knowledgeRuntime:
				process.env.VETTA_KNOWLEDGE_DISABLED === "1" ? undefined : createNodeKnowledgeRuntime(getKnowledgeDir()),
			createMemoryRolloverRuntime: (memoryOptions) => {
				const memoryFile = memoryOptions.memoryFile ?? join(memoryOptions.cwd, "MEMORY.md");
				return createCodingAgentMemoryRolloverRuntime({
					cwd: memoryOptions.cwd,
					memoryFile,
					memoryCharLimit: memoryOptions.memoryCharLimit,
					memoryStorage: new NodeTextFileStorage(memoryFile),
					journalStorage: new NodeTextFileStorage(join(memoryOptions.cwd, "JOURNAL.md")),
				});
			},
			modelRegistry,
			modelInputImageProcessor: nodeModelInputImageProcessor,
			initialModel: initial.model,
			initialThinkingLevel: initial.thinkingLevel,
			cwd,
			workspaceFacts,
			agentDir,
			scenario: options.scenario,
			activation,
			hookConfigLayers: buildDefaultHookConfigLayers({ cwd, vettaHome: getVettaHomePath() }),
			additionalHookAdapterFactories: options.additionalHookAdapterFactories,
			enableSubagents: options.enableSubagents,
			createSubagentId: randomUUID,
			subagentPathPort: { dirname, join },
			subagentMaxConcurrent: options.subagentMaxConcurrent,
			mcpSource: managedMcpSource?.source,
			tracer,
			observationHub: options.observationHub,
			tracing: {
				captureContent: true,
				detail: "standard",
				traceName: options.tracingTraceName ?? process.env.VETTA_TRACING_TRACE_NAME ?? "coding-agent run",
				metadata: {
					...options.tracingMetadata,
					app: "coding-agent",
					cwd,
				},
			},
			promptResourceSource: resourceLoader,
			promptSettingsSource: settingsManager,
			resolveModePrompt: options.resolveModePrompt,
			resolveCompactionSettings: () => settingsManager.getCompactionSettings(),
			createCompactionExtensionRuntime: () =>
				createCodingAgentCompactionExtensionRuntime(() => extensionTransitions.readRunnerOrUndefined()),
			extensionTools: extensionsResult.extensions,
			createPluginMcpRuntime: mcpEnabled
				? ({ cwd: runtimeCwd, agentDir: runtimeAgentDir }) =>
						createCodingAgentPluginMcpRuntime({
							supervisor: createSdkMcpSupervisor({
								cwd: runtimeCwd,
								agentDir: runtimeAgentDir ?? agentDir,
								debug: mcpDebug,
								dynamicOnly: true,
							}),
							debug: mcpDebug,
							resultPolicy: mcpToolResultPolicy,
						})
				: undefined,
		},
		session: {
			cwd,
			scenario: options.scenario,
			model: initial.model,
			thinkingLevel: initial.thinkingLevel,
			agentMode: options.agentMode,
			env: options.env,
			memoryMode: options.memoryMode,
			memoryFile: options.memoryFile,
			memoryCharLimit: options.memoryCharLimit,
			enableBackgroundTasks: options.enableBackgroundTasks,
			includeAgentSkills: options.includeAgentSkills,
			agentPlugins: options.agentPlugins,
			invokePluginTool: options.invokePluginTool,
			invokePluginContinuation: options.invokePluginContinuation,
			invokePluginSystemPrompt: options.invokePluginSystemPrompt,
			pluginTurnHandlerLeaseProvider: options.pluginTurnHandlerLeaseProvider,
			sessionTools,
			sessionExtensionFunctions: sessionFunctions?.source,
		},
		initializeSession: extensionTransitions.initializeSession,
		transitionLifecycle: extensionTransitions.lifecycle,
		createCapabilityHost: createCodingAgentSdkSessionCapabilityHostFactory(capabilityFactoryOptions),
		createActiveCapabilityHost: createCodingAgentSdkActiveSessionCapabilityHostFactory(capabilityFactoryOptions),
		onSessionClosed,
	});

	return {
		session: created.session,
		extensionsResult,
		...(initial.modelFallbackMessage ? { modelFallbackMessage: initial.modelFallbackMessage } : {}),
	};
}

interface SdkSessionFunctionSource {
	readonly source: SessionExtensionFunctionSource;
	dispose(): void;
}

/** 把公共 SDK 的产品能力绑定到 Session Extension functions，不让兼容合同进入 Runtime。 */
function createSdkSessionFunctionSource(
	options: CreateCodingAgentSessionOptions,
): SdkSessionFunctionSource | undefined {
	const capability = options.askUserQuestion;
	if (!capability) return undefined;

	const registry = new SessionExtensionFunctionRegistry();
	registry.register(CODING_AGENT_ASK_USER_QUESTION_FUNCTION, async ({ questions }, signal) => {
		const result = await capability.ask(
			{
				questions: questions.map((question) => ({
					question: question.question,
					header: question.header,
					multiSelect: question.multiSelect,
					options: question.options.map((option) => ({ ...option })),
				})),
			},
			signal,
		);
		return cloneQuestionResult(result);
	});

	return {
		source: {
			has: (token) => capability.isEnabled() && registry.has(token),
			invoke: (token, input, signal) => registry.invoke(token, input, signal),
		},
		dispose: () => registry.close(),
	};
}

function cloneQuestionResult(
	result: Awaited<ReturnType<NonNullable<CreateCodingAgentSessionOptions["askUserQuestion"]>["ask"]>>,
) {
	return {
		cancelled: result.cancelled,
		answers: result.answers.map((answer) => ({
			question: answer.question,
			answers: [...answer.answers],
		})),
	};
}

function createSdkMcpSupervisor(options: {
	readonly cwd: string;
	readonly agentDir: string;
	readonly debug: boolean;
	readonly dynamicOnly?: boolean;
}): McpServerSupervisor {
	return createNodeMcpSupervisor({
		projectRoot: options.cwd,
		agentDir: options.agentDir,
		clientVersion: VERSION,
		projectConfigDirectoryName: CONFIG_DIR_NAME,
		debug: options.debug,
		enabled: true,
		configSource: options.dynamicOnly ? EMPTY_MCP_CONFIG_SOURCE : undefined,
		includeBuiltinServers: !options.dynamicOnly,
		onDiagnostic: (message) => {
			if (options.debug) console.error(`[MCPManager] ${message}`);
		},
	}).supervisor;
}

function resolvePositiveInteger(value: string | undefined): number | undefined {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}
