import { join } from "node:path";
import { buildDefaultHookConfigLayers } from "@vetta/ecosystem-adapter";
import { createLangfuseRuntimeTracerFromEnv } from "@vetta/runtime-telemetry/langfuse";
import { createCodingAgentCompactionExtensionRuntime } from "../../adapters/extensions/compaction-extension-adapter.js";
import { createCodingAgentAuthRuntime } from "../../auth/index.js";
import { DEFAULT_SERVER_URL, ENV_SERVER_URL, getAgentDir, getVettaHomePath } from "../../config.js";
import { createCodingAgentHtmlExportRuntime } from "../../export-html/index.js";
import { createCodingAgentMcpRuntimeToolSource } from "../../mcp/runtime/tool-source.js";
import { createCodingAgentModelRuntime } from "../../models/index.js";
import { createCodingAgentPluginMcpRuntime } from "../../plugins/runtime/mcp-runtime.js";
import {
	CODING_AGENT_SESSION_CREATE_ERROR_CODES,
	CodingAgentSessionCreateError,
	type CodingAgentSessionStorageTarget,
	type CreateCodingAgentSessionOptions,
	type CreateCodingAgentSessionResult,
} from "../../public-api/sdk/index.js";
import { SettingsRuntime } from "../../settings/index.js";
import { createCodingAgentSessionResourceRuntime } from "../coding-agent-resource-runtime.js";
import { CodingAgentSdkExtensionTransitionAdapter } from "../coding-agent-sdk-extension-transition-adapter.js";
import { CodingAgentSdkResourceSourceAdapter } from "../coding-agent-sdk-resource-source-adapter.js";
import { resolveCodingAgentSessionDir } from "../coding-agent-session-storage.js";
import { createCodingAgentExtensionEventHost } from "../extensions/event-host.js";
import {
	CODING_AGENT_SDK_HOST_ERROR_CODES,
	CodingAgentSdkHostError,
	type CodingAgentSdkPublicHostContext,
	type CodingAgentSdkSessionCompositionResult,
} from "./contracts.js";
import { adaptPublicCodingAgentSdkCustomTools, resolvePublicSdkActiveToolNames } from "./custom-tool-adapter.js";
import { resolveSdkInitialModel } from "./initial-model.js";
import { type CodingAgentSdkOwnedResource, createCodingAgentSdkSession } from "./runtime-factory.js";
import {
	createCodingAgentSdkActiveSessionCapabilityHostFactory,
	createCodingAgentSdkSessionCapabilityHostFactory,
} from "./session-capability-hosts.js";

/** `@vetta/coding-agent/sdk` 的产品 Composition 入口；具体管理器不进入公共参数或返回值。 */
export async function createCodingAgentSessionFromPublicOptions(
	options: CreateCodingAgentSessionOptions = {},
	hostContext: CodingAgentSdkPublicHostContext = {},
): Promise<CreateCodingAgentSessionResult> {
	let resourceSourceAdapter: CodingAgentSdkResourceSourceAdapter | undefined;
	try {
		resourceSourceAdapter = await CodingAgentSdkResourceSourceAdapter.create({
			cwd: options.cwd ?? process.cwd(),
			resources: options.resources,
			skillSources: options.skillSources,
			extensionSources: options.extensionSources,
		});
		const created = await createCodingAgentSdkSessionComposition(
			options,
			hostContext,
			resourceSourceAdapter,
			hostContext.onSessionClosed,
		);
		return {
			session: created.session,
			diagnostics: created.extensionsResult.errors.map(({ path, error }) => ({
				code: "extension_load_failed",
				severity: "error",
				source: path,
				message: error,
			})),
			...(created.modelFallbackMessage ? { modelFallbackMessage: created.modelFallbackMessage } : {}),
		};
	} catch (error) {
		if (resourceSourceAdapter) {
			try {
				await resourceSourceAdapter.dispose();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "Public SDK Session creation and resource cleanup failed");
			}
		}
		if (error instanceof CodingAgentSdkHostError && error.code === CODING_AGENT_SDK_HOST_ERROR_CODES.NO_MODEL) {
			throw new CodingAgentSessionCreateError(CODING_AGENT_SESSION_CREATE_ERROR_CODES.NO_MODEL, error.message, {
				cause: error,
			});
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
	const agentDir = options.agentDir ?? getAgentDir();
	const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
	const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
	const authStorage = hostContext.authStorage ?? createCodingAgentAuthRuntime(authPath);
	const htmlExporter = hostContext.htmlExporter ?? createCodingAgentHtmlExportRuntime();
	const modelRegistry =
		hostContext.modelRegistry ?? createCodingAgentModelRuntime(authStorage, { modelsJsonPath: modelsPath });
	const settingsManager = hostContext.settingsManager ?? SettingsRuntime.create(cwd, agentDir);

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
	const resourceLoader = createCodingAgentSessionResourceRuntime({
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
	const managedMcpSource = mcpEnabled
		? await createCodingAgentMcpRuntimeToolSource({
				projectRoot: cwd,
				agentDir,
				debug: settingsManager.getMcpDebug(),
				enabled: true,
			})
		: undefined;
	const ownedResources: CodingAgentSdkOwnedResource[] = [
		...(resourceSourceAdapter ? [resourceSourceAdapter] : []),
		...(managedMcpSource ? [{ id: "sdk-mcp-source", dispose: () => managedMcpSource.dispose() }] : []),
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
		ownedResources,
		composition: {
			modelRegistry,
			initialModel: initial.model,
			initialThinkingLevel: initial.thinkingLevel,
			cwd,
			agentDir,
			scenario: options.scenario,
			activation,
			hookConfigLayers: buildDefaultHookConfigLayers({ cwd, vettaHome: getVettaHomePath() }),
			additionalHookAdapterFactories: options.additionalHookAdapterFactories,
			enableSubagents: options.enableSubagents,
			subagentMaxConcurrent: options.subagentMaxConcurrent,
			mcpSource: managedMcpSource?.source,
			tracer,
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
			resolveCompactionSettings: () => settingsManager.getCompactionSettings(),
			createCompactionExtensionRuntime: () =>
				createCodingAgentCompactionExtensionRuntime(() => extensionTransitions.readRunnerOrUndefined()),
			extensionTools: extensionsResult.extensions,
			createPluginMcpRuntime: mcpEnabled
				? ({ agentDir: runtimeAgentDir }) =>
						createCodingAgentPluginMcpRuntime({
							agentDir: runtimeAgentDir,
							debug: settingsManager.getMcpDebug(),
						})
				: undefined,
		},
		session: {
			cwd,
			model: initial.model,
			thinkingLevel: initial.thinkingLevel,
			agentMode: options.agentMode,
			env: options.env,
			memoryMode: options.memoryMode,
			memoryFile: options.memoryFile,
			memoryCharLimit: options.memoryCharLimit,
			askUserQuestion: options.askUserQuestion
				? {
						isEnabled: () => options.askUserQuestion?.isEnabled() ?? false,
						ask: async (request, signal) => {
							const result = await options.askUserQuestion!.ask(request, signal);
							return {
								cancelled: result.cancelled,
								answers: result.answers.map((answer) => ({
									question: answer.question,
									answers: [...answer.answers],
								})),
							};
						},
					}
				: undefined,
			enableBackgroundTasks: options.enableBackgroundTasks,
			includeAgentSkills: options.includeAgentSkills,
			agentPlugins: options.agentPlugins,
			invokePluginTool: options.invokePluginTool,
			invokePluginContinuation: options.invokePluginContinuation,
			invokePluginSystemPrompt: options.invokePluginSystemPrompt,
			pluginTurnHandlerLeaseProvider: options.pluginTurnHandlerLeaseProvider,
			sessionTools,
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
