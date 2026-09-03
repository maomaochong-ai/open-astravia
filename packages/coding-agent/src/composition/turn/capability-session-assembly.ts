import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type { RuntimeModel } from "@vetta/runtime-core";
import type {
	AgentFeatureDefinition,
	ContinuationPolicyContext,
	ModelCallContributionContext,
	RuntimeCapabilityDefinition,
	RuntimeSnapshotProvider,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import type { SessionExtensionContinuationSource } from "@vetta/runtime-core/session-extensions";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import { guardCodingToolRegistration } from "@vetta/runtime-tools";
import { createEcosystemToolInterceptor } from "../../adapters/ecosystem/tool-interceptor-adapter.js";
import { CodingAgentPromptRequestAdapter } from "../../adapters/runtime-core/prompt-request-adapter.js";
import { CodingAgentLegacyImageSettingsRuntime } from "../../adapters/settings/legacy-image-settings-adapter.js";
import type { AgentConfiguration } from "../../agent-configuration/configuration-schema.js";
import {
	allowsAgentResource,
	createAgentToolSelection,
	readAgentPluginIds,
	selectAgentPlugins,
	selectAgentPromptResourceResolver,
	selectAgentSkillSource,
} from "../../agent-configuration/resource-selection.js";
import type { AgentSessionConfiguration } from "../../agent-configuration/session-configuration.js";
import type { CodingAgentSessionExecutionRuntime } from "../../execution/session/runtime.js";
import type { CodingAgentExtensionRunBridge } from "../../extensions/runtime/extension-run-bridge.js";
import type { CodingAgentExtensionToolRuntime } from "../../extensions/runtime/extension-tool-runtime.js";
import { CodingAgentStopHookContinuationSource } from "../../extensions/runtime/stop-hook-continuation-source.js";
import type { CodingAgentTodoRuntime } from "../../features/todo/contracts.js";
import { DynamicContributionCatalog } from "../../interception/contribution-catalog.js";
import {
	CODING_AGENT_TOOL_INTERCEPTION_ORDER,
	type CodingAgentToolInterceptor,
} from "../../interception/tool/contracts.js";
import { wrapRuntimeToolsWithInterceptionPipeline } from "../../interception/tool/pipeline.js";
import type { CodingAgentMemoryRolloverRuntime } from "../../memory/index.js";
import type { ModelInputImageProcessor } from "../../model-context/image-normalization.js";
import { CodingAgentModelCallFrameComposer } from "../../model-context/model-call-frame-composer.js";
import { CodingAgentModelCallMessageFinalizer } from "../../model-context/model-call-message-finalizer.js";
import type { AgentPluginRuntimeConfig } from "../../model-context/plugin-runtime.js";
import { CodingAgentPromptRuntime } from "../../model-context/prompt-runtime.js";
import type { CodingAgentModePromptResolver } from "../../model-context/system-prompt-sources.js";
import { CodingAgentPluginRunOrchestrator } from "../../plugins/runtime/run-orchestrator.js";
import {
	type CodingAgentPluginToolActivation,
	CodingAgentPluginToolRuntime,
} from "../../plugins/runtime/tool-runtime.js";
import type { ConversationScenario } from "../../profiles/index.js";
import { createCodingAgentPromptResourceResolver } from "../../resources/prompt-resource-resolver.js";
import { createCodingAgentInvokeSkillFeature } from "../../resources/skills/invoke-skill-feature.js";
import type {
	CodingAgentContextRuntime,
	CodingAgentPluginMcpRuntime,
	CodingAgentPluginRuntimeSource,
	CodingAgentPromptResourceResolver,
	CodingAgentPromptResourceSource,
	CodingAgentPromptSettingsSource,
	CodingAgentRuntimeToolRegistration,
	CodingAgentSystemPromptOptionsResolver,
	CodingAgentToolActivation,
} from "../../runtime-contracts/index.js";
import type { CodingAgentSessionInitializationTimeline } from "../session-initialization/initialization-timeline.js";
import type { CodingAgentSubagentRuntime } from "../subagent/runtime.js";
import type { CodingToolsRuntimeComposition } from "../tool-surface/runtime-tools-composition.js";
import { CodingAgentContinuationOrchestrator } from "./continuation-orchestrator.js";
import { createEcosystemHookTurnObserver } from "./ecosystem-hook-turn-observer.js";
import type { CodingAgentImageSettingsSnapshotRouter } from "./image-settings-snapshot-router.js";
import { CodingAgentLengthContinuationSource } from "./length-continuation-source.js";

export interface CodingAgentTurnCapabilitySessionIdentity {
	readonly initialSessionId: string;
	readonly readSessionId: () => string;
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly agentDir?: string;
	readonly includeAgentSkills?: boolean;
	readonly systemPromptAddon?: string;
	readonly systemPromptCachePrefixAddon?: string;
	readonly systemPromptVolatileAddon?: string;
	readonly promptCacheKey?: string;
}

export interface CodingAgentTurnCapabilityActivationPort {
	readonly resolve: (context: ModelCallContributionContext) => CodingAgentToolActivation;
	readonly readAgentMode: () => string | undefined;
	readonly readAgentPlugins: () => AgentPluginRuntimeConfig | undefined;
	readonly readActiveToolNamesOverride: () => readonly string[] | undefined;
	readonly bindForTurn?: () => {
		readonly resolve: (context: ModelCallContributionContext) => CodingAgentToolActivation;
		readonly agentMode: string | undefined;
		readonly agentPlugins: AgentPluginRuntimeConfig | undefined;
		readonly activeToolNamesOverride: readonly string[] | undefined;
	};
}

export interface CodingAgentTurnCapabilityPromptOptions {
	readonly runtimeSourceFactory?: (context: { readonly runtimeSkillPaths: readonly string[] }) => Promise<{
		readonly resourceSource: CodingAgentPromptResourceSource;
		readonly settingsSource: CodingAgentPromptSettingsSource;
	}>;
	readonly systemPromptOptionsResolver?: CodingAgentSystemPromptOptionsResolver;
	readonly promptResourceResolver?: CodingAgentPromptResourceResolver;
	readonly resourceSource?: CodingAgentPromptResourceSource;
	readonly settingsSource?: CodingAgentPromptSettingsSource;
	readonly systemPromptAdvertisedToolNames?: readonly string[];
	readonly workspaceFacts?: string;
	/** 宿主注入的 mode 提示词解析器；缺省 = 不追加 mode block（ADR-0071 修订）。 */
	readonly resolveModePrompt?: CodingAgentModePromptResolver;
}

export interface CodingAgentTurnCapabilitySessionAssemblyOptions {
	readonly agentConfiguration: AgentSessionConfiguration;
	readonly readAllAgentPlugins: () => AgentPluginRuntimeConfig | undefined;
	readonly session: CodingAgentTurnCapabilitySessionIdentity;
	readonly activation: CodingAgentTurnCapabilityActivationPort;
	readonly prompt: CodingAgentTurnCapabilityPromptOptions;
	readonly baseCapabilities: RuntimeCapabilityDefinition;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly executionRuntime: CodingAgentSessionExecutionRuntime;
	readonly specializedToolFeature: AgentFeatureDefinition;
	readonly specializedToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly continuationSources: readonly SessionExtensionContinuationSource[];
	readonly todoRuntime: CodingAgentTodoRuntime;
	readonly todoToolRegistration?: CodingAgentRuntimeToolRegistration;
	readonly memoryRuntime?: CodingAgentMemoryRolloverRuntime;
	readonly subagentRuntime?: CodingAgentSubagentRuntime;
	readonly contextRuntime: CodingAgentContextRuntime;
	readonly conversationContextProjector: NonNullable<RuntimeCapabilityDefinition["conversationContextProjector"]>;
	readonly modelRuntime: RuntimeModel;
	readonly modelInputImageProcessor?: ModelInputImageProcessor;
	readonly hookRuntime: EcosystemHookRuntime;
	readonly pluginRuntime?: CodingAgentPluginRuntimeSource;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly mcpController?: McpDeferredToolController;
	readonly extensionEvents: CodingAgentExtensionRunBridge;
	readonly extensionToolRuntime?: CodingAgentExtensionToolRuntime;
	readonly initializationTimeline?: CodingAgentSessionInitializationTimeline;
	readonly imageSettingsSnapshots: CodingAgentImageSettingsSnapshotRouter;
	readonly reportActiveToolNames?: (activeToolNames: readonly string[]) => Promise<void> | void;
}

export interface CodingAgentTurnCapabilitySessionAssembly {
	/** 由 RuntimeAgentRuntime 唯一编译的产品能力定义；本装配不再拥有第二套 Snapshot generation。 */
	readonly capabilityDefinition: RuntimeCapabilityDefinition;
	readonly promptAdapter: CodingAgentPromptRequestAdapter;
	readAvailableTools(): ReadonlyMap<string, RuntimeToolDefinition>;
	refreshConfigurationResources(signal?: AbortSignal): Promise<void>;
	readPluginActiveToolNames(): readonly string[] | undefined;
	reconfigureAgentPluginSkills(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void>;
	rebindSession(sessionId: string): void;
	previewInitialSystemPrompt(acquireSnapshot: () => ReturnType<RuntimeSnapshotProvider["acquire"]>): Promise<void>;
	dispose(): Promise<void>;
}

/** 组装单个 Session 的 Prompt、Plugin、Continuation、Tool Frame 与 Capability snapshot。 */
export async function createCodingAgentTurnCapabilitySessionAssembly(
	options: CodingAgentTurnCapabilitySessionAssemblyOptions,
): Promise<CodingAgentTurnCapabilitySessionAssembly> {
	const mcpController = options.mcpController;
	const pluginSession = {
		id: options.session.initialSessionId,
		cwd: options.session.cwd,
		scenario: options.session.scenario,
	};
	const pluginRunOrchestrator = options.pluginRuntime
		? new CodingAgentPluginRunOrchestrator({
				session: pluginSession,
				...options.pluginRuntime,
				readAgentPlugins: options.activation.readAgentPlugins,
			})
		: undefined;
	const pluginToolRuntime =
		options.pluginRuntime && pluginRunOrchestrator
			? new CodingAgentPluginToolRuntime({
					readAgentPlugins: options.activation.readAgentPlugins,
					invokeTool: options.pluginRuntime.invokeTool,
					runOrchestrator: pluginRunOrchestrator,
					shouldPreserveBaseTool: (toolName) =>
						options.mcpController?.isManagedTool(toolName) === true ||
						options.extensionToolRuntime?.hasTool(toolName, options.session.readSessionId()) === true,
					resolveActivation: (context) => toPluginToolActivation(options.activation.resolve(context)),
					bindActivation: () => {
						const bound = readBoundActivation(options.activation);
						return (context) => toPluginToolActivation(bound.resolve(context));
					},
					bindPreservedBaseToolNames: () =>
						new Set([
							...(options.pluginMcpRuntime?.view().tools.map(({ tool }) => tool.name) ?? []),
							...(options.extensionToolRuntime?.readAvailableTools(options.session.readSessionId()).keys() ??
								[]),
						]),
				})
			: undefined;
	const stopHookContinuationSource = new CodingAgentStopHookContinuationSource({ hookRuntime: options.hookRuntime });
	const lengthContinuationSource = new CodingAgentLengthContinuationSource();
	const continuationOrchestrator = new CodingAgentContinuationOrchestrator({
		sources: [
			lengthContinuationSource,
			...options.continuationSources,
			...(pluginRunOrchestrator
				? [
						{
							id: "plugin",
							priority: 200,
							collect: (context: ContinuationPolicyContext) => pluginRunOrchestrator.collect(context),
						},
					]
				: []),
			{
				id: "stop-hook",
				priority: 300,
				collect: (context) => stopHookContinuationSource.collect(context),
			},
		],
	});
	const promptSources = options.initializationTimeline
		? await options.initializationTimeline.measure("prompt-runtime", () => createPromptRuntime(options))
		: await createPromptRuntime(options);
	const { runtime: promptRuntime, resourceSource: promptResourceSource, rawResourceSource } = promptSources;
	const resolveSystemPromptOptions =
		options.prompt.systemPromptOptionsResolver ?? promptRuntime?.resolveSystemPromptOptions;
	if (!resolveSystemPromptOptions) {
		throw new Error("Coding Agent system prompt resolver was not created");
	}
	const applyPluginSkills = async (): Promise<void> => {
		await promptResourceSource?.setRuntimeSkillPaths(readPluginSkillPaths(options.activation.readAgentPlugins()));
	};
	if (options.initializationTimeline) {
		await options.initializationTimeline.measure("plugin-skills", applyPluginSkills);
	} else {
		await applyPluginSkills();
	}
	const imageSettingsSource = options.prompt.settingsSource ?? promptRuntime?.readSettingsSource();
	const imageConfigurationRuntime = new CodingAgentLegacyImageSettingsRuntime({
		settings: imageSettingsSource,
		observationPublisher: options.baseCapabilities.observationPublisher,
	});
	let imageSettingsScopeId = options.session.initialSessionId;
	try {
		options.imageSettingsSnapshots.register(imageSettingsScopeId, imageConfigurationRuntime);
	} catch (error) {
		await imageConfigurationRuntime.close();
		throw error;
	}
	const modelCallMessageFinalizer = new CodingAgentModelCallMessageFinalizer(
		undefined,
		options.modelInputImageProcessor,
		options.imageSettingsSnapshots,
	);
	const enhanceSystemPromptOptions = async (
		resolver: CodingAgentSystemPromptOptionsResolver,
		context: Parameters<CodingAgentSystemPromptOptionsResolver>[0],
		agentPlugins: AgentPluginRuntimeConfig | undefined,
		memory: string | undefined,
		configuration: AgentConfiguration,
	) => {
		const promptOptions = await resolver(context);
		return {
			...promptOptions,
			cwd: promptOptions.cwd ?? options.session.cwd,
			agentPlugins: selectAgentPlugins(promptOptions.agentPlugins ?? agentPlugins, configuration.plugins),
			skills: promptOptions.skills?.filter((skill) => allowsAgentResource(configuration.skills, skill.name)),
			appendSystemPrompt: joinPromptAddons(
				joinPromptAddons(promptOptions.appendSystemPrompt, options.session.systemPromptAddon),
				configuration.appendSystemPrompt,
			),
			systemPromptCachePrefixAddon: joinPromptAddons(
				promptOptions.systemPromptCachePrefixAddon,
				options.session.systemPromptCachePrefixAddon,
			),
			systemPromptVolatileAddon: joinPromptAddons(
				promptOptions.systemPromptVolatileAddon,
				options.session.systemPromptVolatileAddon,
			),
			...(memory ? { memory } : {}),
		};
	};
	const invokeSkillFeature = promptResourceSource
		? createCodingAgentInvokeSkillFeature({
				resourceSource: promptResourceSource,
				hookRuntime: options.hookRuntime,
			})
		: undefined;
	const toolInterceptionCatalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
	toolInterceptionCatalog.register({
		sourceId: "ecosystem",
		localId: "tool-hooks",
		revision: "session",
		order: CODING_AGENT_TOOL_INTERCEPTION_ORDER.ecosystem,
		value: createEcosystemToolInterceptor(options.hookRuntime),
	});
	if (options.extensionEvents) {
		toolInterceptionCatalog.register({
			sourceId: "coding-extension",
			localId: "tool-events",
			revision: "session",
			order: CODING_AGENT_TOOL_INTERCEPTION_ORDER.extension,
			value: options.extensionEvents.createToolInterceptor(),
		});
	}
	const readAvailableTools = () =>
		new Map([
			...options.codingTools.registry
				.snapshot()
				.entries.filter((entry) => !options.executionRuntime.ownsTool(entry.registration.tool.name))
				.map(
					(entry) =>
						[
							entry.registration.tool.name,
							guardCodingToolRegistration(options.codingTools.registry, entry),
						] as const,
				),
			...options.executionRuntime.readAvailableTools(),
			...options.specializedToolRegistrations.map(({ tool }) => [tool.name, tool] as const),
			...(options.todoToolRegistration
				? [[options.todoToolRegistration.tool.name, options.todoToolRegistration.tool] as const]
				: []),
			...(options.memoryRuntime
				? [[options.memoryRuntime.toolRegistration.tool.name, options.memoryRuntime.toolRegistration.tool] as const]
				: []),
			...(options.subagentRuntime
				? options.subagentRuntime.readTools().map((tool) => [tool.name, tool] as const)
				: []),
			...(invokeSkillFeature ? [[invokeSkillFeature.tool.name, invokeSkillFeature.tool] as const] : []),
			...(options.extensionToolRuntime?.readAvailableTools(options.session.readSessionId()) ?? []),
		]);
	options.agentConfiguration.attachCatalog(() => ({
		skills: [...new Set(rawResourceSource?.getSkills().skills.map(({ name }) => name) ?? [])].sort(),
		tools: [
			...new Set([
				...readAvailableTools().keys(),
				...(options.mcpController?.readCatalog().map(({ name }) => name) ?? []),
				...(options.readAllAgentPlugins()?.toolContributions?.map(({ name }) => name) ?? []),
			]),
		].sort(),
		mcpServers: [
			...new Set(
				(options.mcpController?.readCatalog() ?? []).flatMap(({ serverName }) => (serverName ? [serverName] : [])),
			),
		].sort(),
		plugins: [
			...new Set([
				...readAgentPluginIds(options.readAllAgentPlugins()),
				...(options.pluginRuntime?.readPluginIds?.() ?? []),
			]),
		].sort(),
		models: options.modelRuntime
			.readAvailableModels()
			.map((model) => ({ key: `${model.provider}/${model.id}`, name: model.name })),
	}));
	const bindToolSelection = () =>
		createAgentToolSelection(options.agentConfiguration.readAdmitted(), options.mcpController?.readCatalog() ?? []);
	const modelCallFrameComposer = new CodingAgentModelCallFrameComposer({
		promptCacheKey: options.session.promptCacheKey,
		allowsTool: (name) => bindToolSelection()(name),
		bindToolSelection,
		readMcpPromptState: mcpController ? () => mcpController.readPromptState() : undefined,
		readAvailableTools,
		readActiveToolNamesOverride: options.activation.readActiveToolNamesOverride,
		pluginRunOrchestrator,
		pluginMcpRuntime: options.pluginMcpRuntime,
		pluginToolRuntime,
		readAgentPlugins: options.activation.readAgentPlugins,
		pluginHandlerLeaseProvider: options.pluginRuntime?.handlerLeaseProvider,
		readAgentMode: options.activation.readAgentMode,
		isMcpToolVisible: (toolName) => options.mcpController?.isToolVisible(toolName) ?? true,
		bindMcpToolVisibility: () => options.mcpController?.bindToolVisibility() ?? (() => true),
		systemPromptAdvertisedToolNames: options.prompt.systemPromptAdvertisedToolNames,
		wrapTools: (tools, context) => {
			const hookedTools = wrapRuntimeToolsWithInterceptionPipeline(tools, toolInterceptionCatalog, context);
			return invokeSkillFeature?.wrapHookActivation(hookedTools) ?? hookedTools;
		},
		bindToolWrapper: (context) => {
			const boundExtensionEvents = options.extensionEvents.bindAdapterForTurn(context);
			const catalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
			catalog.register({
				sourceId: "ecosystem",
				localId: "tool-hooks",
				revision: "turn",
				order: CODING_AGENT_TOOL_INTERCEPTION_ORDER.ecosystem,
				value: createEcosystemToolInterceptor(options.hookRuntime),
			});
			catalog.register({
				sourceId: "coding-extension",
				localId: "tool-events",
				revision: "turn",
				order: CODING_AGENT_TOOL_INTERCEPTION_ORDER.extension,
				value: boundExtensionEvents.createToolInterceptor(),
			});
			return {
				wrapTools: (tools, frameContext) => {
					const intercepted = wrapRuntimeToolsWithInterceptionPipeline(tools, catalog, frameContext);
					return invokeSkillFeature?.wrapHookActivation(intercepted) ?? intercepted;
				},
				release: () => boundExtensionEvents.releaseTurnBinding(),
			};
		},
		extensionEvents: options.extensionEvents,
		extensionToolRuntime: options.extensionToolRuntime,
		resolveExtensionToolActivation: options.activation.resolve,
		bindExtensionToolActivation: () => readBoundActivation(options.activation).resolve,
		resolveSystemPromptOptions: (context) =>
			enhanceSystemPromptOptions(
				resolveSystemPromptOptions,
				context,
				options.activation.readAgentPlugins(),
				options.memoryRuntime?.renderPromptMemory(),
				options.agentConfiguration.readAdmitted(),
			),
		bindSystemPromptOptions: async (context) => {
			const resolver = (await promptRuntime?.bindForTurn(context.signal)) ?? resolveSystemPromptOptions;
			const agentPlugins = options.activation.readAgentPlugins();
			const memory = options.memoryRuntime?.renderPromptMemory();
			const configuration = options.agentConfiguration.readAdmitted();
			return (context) => enhanceSystemPromptOptions(resolver, context, agentPlugins, memory, configuration);
		},
		reportActiveToolNames: options.reportActiveToolNames,
	});
	const promptAdapter = new CodingAgentPromptRequestAdapter({
		resolvePromptResource: selectAgentPromptResourceResolver(
			options.prompt.promptResourceResolver ??
				(promptResourceSource
					? createCodingAgentPromptResourceResolver({
							resourceLoader: promptResourceSource,
							todoState: options.todoRuntime,
						})
					: undefined),
			() => options.agentConfiguration.readAdmitted(),
		),
		hookRuntime: options.hookRuntime,
		extensionEvents: options.extensionEvents,
		onPrepared: () => options.todoRuntime.flush(),
	});
	const capabilityDefinition: RuntimeCapabilityDefinition = {
		...options.baseCapabilities,
		features: [
			...options.baseCapabilities.features,
			options.specializedToolFeature,
			...(invokeSkillFeature ? [invokeSkillFeature] : []),
		],
		observers: [
			...(options.baseCapabilities.observers ?? []),
			options.contextRuntime,
			createEcosystemHookTurnObserver(options.hookRuntime),
			...(options.memoryRuntime ? [options.memoryRuntime] : []),
		],
		contextStrategy: options.contextRuntime,
		contextSummaryStrategy: options.contextRuntime,
		manualCompactionStrategy: options.contextRuntime,
		contextCompositionPublisher: options.contextRuntime,
		modelCallContextTransformer: options.contextRuntime,
		modelCallMessageFinalizer,
		conversationContextProjector: options.conversationContextProjector,
		agentRunPreparer: options.extensionEvents,
		continuationPolicy: continuationOrchestrator,
		modelCallFrameComposer,
		inputRequestPreparer: promptAdapter,
	};
	return {
		capabilityDefinition,
		async refreshConfigurationResources(signal) {
			await rawResourceSource?.refreshSkillsIfChanged(signal);
			options.modelRuntime.refreshAvailableModels();
		},
		promptAdapter,
		readAvailableTools,
		readPluginActiveToolNames: () => pluginRunOrchestrator?.readActiveToolNames(),
		async reconfigureAgentPluginSkills(agentPlugins) {
			await promptResourceSource?.setRuntimeSkillPaths(readPluginSkillPaths(agentPlugins));
		},
		rebindSession(sessionId) {
			options.imageSettingsSnapshots.rebind(imageSettingsScopeId, sessionId, imageConfigurationRuntime);
			imageSettingsScopeId = sessionId;
			pluginSession.id = sessionId;
		},
		async previewInitialSystemPrompt(acquireSnapshot) {
			const sessionId = options.session.readSessionId();
			const operationId = `${sessionId}:extension-context-preview`;
			const signal = new AbortController().signal;
			// Initialization has just loaded the Session resource generation and applied
			// plugin Skill paths. Bind-free acquisition preserves that committed snapshot
			// for the extension-context baseline without immediately repeating the
			// Turn-admission filesystem freshness scan. A real Turn still binds normally
			// and therefore observes resource changes made after initialization.
			const initialSnapshotLease = await acquireSnapshot();
			try {
				const admittedComposer = initialSnapshotLease.snapshot.modelCallFrameComposer;
				const previewComposer =
					admittedComposer instanceof CodingAgentModelCallFrameComposer
						? admittedComposer
						: modelCallFrameComposer;
				await previewComposer.previewSystemPrompt({
					sessionId,
					turnId: operationId,
					signal,
					messages: [],
					modelBinding: initialSnapshotLease.modelBinding ?? (await options.modelRuntime.bind()),
					frame: {
						instructions: initialSnapshotLease.snapshot.instructions,
						tools: initialSnapshotLease.snapshot.tools,
					},
				});
			} finally {
				await initialSnapshotLease.release();
			}
		},
		async dispose() {
			options.imageSettingsSnapshots.unregister(imageSettingsScopeId, imageConfigurationRuntime);
			await imageConfigurationRuntime.close();
		},
	};
}

async function createPromptRuntime(options: CodingAgentTurnCapabilitySessionAssemblyOptions) {
	const factorySources =
		options.prompt.resourceSource && options.prompt.settingsSource
			? undefined
			: await options.prompt.runtimeSourceFactory?.({
					runtimeSkillPaths: readPluginSkillPaths(options.activation.readAgentPlugins()),
				});
	const rawResourceSource = options.prompt.resourceSource ?? factorySources?.resourceSource;
	const resourceSource = rawResourceSource
		? selectAgentSkillSource(rawResourceSource, () => options.agentConfiguration.readAdmitted())
		: undefined;
	const settingsSource = options.prompt.settingsSource ?? factorySources?.settingsSource;
	if (options.prompt.systemPromptOptionsResolver || !resourceSource || !settingsSource)
		return { rawResourceSource, resourceSource, runtime: undefined };
	const memoryRuntime = options.memoryRuntime;
	const runtime = new CodingAgentPromptRuntime({
		cwd: options.session.cwd,
		resourceLoader: resourceSource,
		settingsManager: settingsSource,
		scenario: options.session.scenario,
		readAgentMode: options.activation.readAgentMode,
		resolveModePrompt: options.prompt.resolveModePrompt,
		readMemory: memoryRuntime ? () => memoryRuntime.readPromptMemory() : undefined,
		readAgentPlugins: options.activation.readAgentPlugins,
		workspaceFacts: options.prompt.workspaceFacts,
	});
	return { runtime, rawResourceSource, resourceSource };
}

function readPluginSkillPaths(agentPlugins: AgentPluginRuntimeConfig | undefined): string[] {
	return agentPlugins?.skillPathContributions?.flatMap((contribution) => contribution.paths) ?? [];
}

function toPluginToolActivation(activation: CodingAgentToolActivation): CodingAgentPluginToolActivation {
	if (activation.mode === "explicit") return activation;
	return {
		mode: "scope",
		scenario: activation.scope ?? "cli",
		capabilities: activation.capabilities,
		additionallyEnabledToolNames: activation.additionallyEnabledToolNames,
	};
}

function readBoundActivation(
	activation: CodingAgentTurnCapabilityActivationPort,
): ReturnType<NonNullable<CodingAgentTurnCapabilityActivationPort["bindForTurn"]>> {
	return (
		activation.bindForTurn?.() ?? {
			resolve: activation.resolve,
			agentMode: activation.readAgentMode(),
			agentPlugins: activation.readAgentPlugins(),
			activeToolNamesOverride: activation.readActiveToolNamesOverride(),
		}
	);
}

function joinPromptAddons(base: string | undefined, addon: string | undefined): string | undefined {
	const parts = [base, addon].filter((value): value is string => Boolean(value?.trim()));
	return parts.length > 0 ? parts.join("\n\n") : undefined;
}
