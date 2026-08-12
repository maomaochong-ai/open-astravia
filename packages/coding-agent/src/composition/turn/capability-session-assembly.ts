import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type { AgentPluginRuntimeConfig, ConversationScenario, RuntimeModel } from "@vetta/runtime-core";
import {
	type AgentFeatureDefinition,
	type AgentProfile,
	type ModelCallContributionContext,
	RuntimeCapabilityComposition,
	type RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import { type CodingToolActivation, guardCodingToolRegistration } from "@vetta/runtime-tools/coding";
import type { CodingAgentContextRuntime } from "../../adapters/runtime-core/context-runtime/index.js";
import { createEcosystemToolInterceptor } from "../../adapters/runtime-core/ecosystem-hook-tool-wrapper.js";
import type { CodingAgentExtensionRunAdapter } from "../../adapters/runtime-core/extension-run-adapter.js";
import { CodingAgentPromptRequestAdapter } from "../../adapters/runtime-core/prompt-request-adapter.js";
import type { CodingAgentExtensionToolRuntime } from "../../extensions/runtime/extension-tool-runtime.js";
import { CodingAgentStopHookContinuationSource } from "../../extensions/runtime/stop-hook-continuation-source.js";
import type { CodingAgentSessionExecutionRuntime } from "../../host/session-execution/execution-runtime.js";
import { DynamicContributionCatalog } from "../../interception/contribution-catalog.js";
import {
	CODING_AGENT_TOOL_INTERCEPTION_ORDER,
	type CodingAgentToolInterceptor,
} from "../../interception/tool/contracts.js";
import { wrapRuntimeToolsWithInterceptionPipeline } from "../../interception/tool/pipeline.js";
import type { CodingAgentMemoryRolloverRuntime } from "../../memory/index.js";
import { CodingAgentModelCallFrameComposer } from "../../model-context/model-call-frame-composer.js";
import { CodingAgentModelCallMessageFinalizer } from "../../model-context/model-call-message-finalizer.js";
import { CodingAgentPromptRuntime } from "../../model-context/prompt-runtime.js";
import { CodingAgentPluginRunOrchestrator } from "../../plugins/runtime/run-orchestrator.js";
import {
	type CodingAgentPluginToolActivation,
	CodingAgentPluginToolRuntime,
} from "../../plugins/runtime/tool-runtime.js";
import { createCodingAgentPromptResourceResolver } from "../../resources/prompt-resource-resolver.js";
import { createCodingAgentInvokeSkillFeature } from "../../resources/skills/invoke-skill-feature.js";
import type {
	CodingAgentPluginMcpRuntime,
	CodingAgentPluginRuntimeSource,
	CodingAgentPromptResourceResolver,
	CodingAgentPromptResourceSource,
	CodingAgentPromptSettingsSource,
	CodingAgentRuntimeToolRegistration,
	CodingAgentSystemPromptOptionsResolver,
} from "../../runtime-contracts/index.js";
import type { CodingAgentTodoRuntime } from "../../work-state/contracts.js";
import { CodingAgentTodoContinuationSource } from "../../work-state/todo-continuation-source.js";
import type { CodingAgentSubagentRuntime } from "../subagent/runtime.js";
import type { CodingToolsRuntimeComposition } from "../tool-surface/runtime-tools-composition.js";
import { CodingAgentContinuationOrchestrator } from "./continuation-orchestrator.js";
import { createEcosystemHookTurnObserver } from "./ecosystem-hook-turn-observer.js";
import { createCodingAgentPromptRuntime } from "./prompt-runtime-factory.js";

export interface CodingAgentTurnCapabilitySessionIdentity {
	readonly initialSessionId: string;
	readonly readSessionId: () => string;
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly agentDir?: string;
	readonly includeAgentSkills?: boolean;
	readonly systemPromptAddon?: string;
}

export interface CodingAgentTurnCapabilityActivationPort {
	readonly resolve: (context: ModelCallContributionContext) => CodingToolActivation;
	readonly readAgentMode: () => string | undefined;
	readonly readAgentPlugins: () => AgentPluginRuntimeConfig | undefined;
	readonly readActiveToolNamesOverride: () => readonly string[] | undefined;
	readonly bindForTurn?: () => {
		readonly resolve: (context: ModelCallContributionContext) => CodingToolActivation;
		readonly agentMode: string | undefined;
		readonly agentPlugins: AgentPluginRuntimeConfig | undefined;
		readonly activeToolNamesOverride: readonly string[] | undefined;
	};
}

export interface CodingAgentTurnCapabilityPromptOptions {
	readonly systemPromptOptionsResolver?: CodingAgentSystemPromptOptionsResolver;
	readonly promptResourceResolver?: CodingAgentPromptResourceResolver;
	readonly resourceSource?: CodingAgentPromptResourceSource;
	readonly settingsSource?: CodingAgentPromptSettingsSource;
	readonly systemPromptAdvertisedToolNames?: readonly string[];
}

export interface CodingAgentTurnCapabilitySessionAssemblyOptions {
	readonly session: CodingAgentTurnCapabilitySessionIdentity;
	readonly activation: CodingAgentTurnCapabilityActivationPort;
	readonly prompt: CodingAgentTurnCapabilityPromptOptions;
	readonly baseProfile: AgentProfile;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly executionRuntime: CodingAgentSessionExecutionRuntime;
	readonly productToolFeature: AgentFeatureDefinition;
	readonly productToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly todoRuntime: CodingAgentTodoRuntime;
	readonly todoToolRegistration?: CodingAgentRuntimeToolRegistration;
	readonly memoryRuntime?: CodingAgentMemoryRolloverRuntime;
	readonly subagentRuntime?: CodingAgentSubagentRuntime;
	readonly contextRuntime: CodingAgentContextRuntime;
	readonly conversationContextProjector: NonNullable<AgentProfile["conversationContextProjector"]>;
	readonly modelRuntime: RuntimeModel;
	readonly hookRuntime: EcosystemHookRuntime;
	readonly pluginRuntime?: CodingAgentPluginRuntimeSource;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly mcpController?: McpDeferredToolController;
	readonly extensionEvents: CodingAgentExtensionRunAdapter;
	readonly extensionToolRuntime?: CodingAgentExtensionToolRuntime;
}

export interface CodingAgentTurnCapabilitySessionAssembly {
	readonly capabilities: RuntimeCapabilityComposition;
	readonly promptAdapter: CodingAgentPromptRequestAdapter;
	readAvailableTools(): ReadonlyMap<string, RuntimeToolDefinition>;
	readPluginActiveToolNames(): readonly string[] | undefined;
	reconfigureAgentPluginSkills(agentPlugins: AgentPluginRuntimeConfig | undefined): void;
	rebindSession(sessionId: string): void;
	previewInitialSystemPrompt(): Promise<void>;
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
					resolveActivation: (context) =>
						toPluginToolActivation(options.activation.resolve(context), options.activation.readAgentMode()),
					bindActivation: () => {
						const bound = readBoundActivation(options.activation);
						return (context) => toPluginToolActivation(bound.resolve(context), bound.agentMode);
					},
					bindPreservedBaseToolNames: () =>
						new Set([
							...(options.pluginMcpRuntime?.view().tools.map(({ tool }) => tool.name) ?? []),
							...(options.extensionToolRuntime?.readAvailableTools(options.session.readSessionId()).keys() ??
								[]),
						]),
				})
			: undefined;
	const continuationOrchestrator = new CodingAgentContinuationOrchestrator({
		todo: new CodingAgentTodoContinuationSource({ state: options.todoRuntime }),
		plugin: pluginRunOrchestrator,
		stopHook: new CodingAgentStopHookContinuationSource({ hookRuntime: options.hookRuntime }),
	});
	const promptRuntime = await createPromptRuntime(options);
	const resolveSystemPromptOptions =
		options.prompt.systemPromptOptionsResolver ?? promptRuntime?.resolveSystemPromptOptions;
	if (!resolveSystemPromptOptions) {
		throw new Error("Coding Agent system prompt resolver was not created");
	}
	const promptResourceSource = options.prompt.resourceSource ?? promptRuntime?.readResourceSource();
	promptResourceSource?.setRuntimeSkillPaths(readPluginSkillPaths(options.activation.readAgentPlugins()));
	const modelCallMessageFinalizer = new CodingAgentModelCallMessageFinalizer(
		options.prompt.settingsSource ?? promptRuntime?.readSettingsSource(),
	);
	const enhanceSystemPromptOptions = async (
		resolver: CodingAgentSystemPromptOptionsResolver,
		context: Parameters<CodingAgentSystemPromptOptionsResolver>[0],
		agentPlugins: AgentPluginRuntimeConfig | undefined,
		memory: string | undefined,
	) => {
		const promptOptions = await resolver(context);
		return {
			...promptOptions,
			cwd: promptOptions.cwd ?? options.session.cwd,
			agentPlugins: promptOptions.agentPlugins ?? agentPlugins,
			appendSystemPrompt: joinPromptAddons(promptOptions.appendSystemPrompt, options.session.systemPromptAddon),
			...(memory ? { memory } : {}),
		};
	};
	const invokeSkillFeature = promptResourceSource
		? createCodingAgentInvokeSkillFeature({
				resourceSource: promptResourceSource,
				readAgentMode: options.activation.readAgentMode,
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
			...options.productToolRegistrations.map(({ tool }) => [tool.name, tool] as const),
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
	const modelCallFrameComposer = new CodingAgentModelCallFrameComposer({
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
			),
		bindSystemPromptOptions: () => {
			const resolver = promptRuntime?.bindForTurn() ?? resolveSystemPromptOptions;
			const agentPlugins = options.activation.readAgentPlugins();
			const memory = options.memoryRuntime?.renderPromptMemory();
			return (context) => enhanceSystemPromptOptions(resolver, context, agentPlugins, memory);
		},
	});
	const promptAdapter = new CodingAgentPromptRequestAdapter({
		resolvePromptResource:
			options.prompt.promptResourceResolver ??
			(options.prompt.resourceSource
				? createCodingAgentPromptResourceResolver({
						resourceLoader: options.prompt.resourceSource,
						todoState: options.todoRuntime,
					})
				: undefined),
		hookRuntime: options.hookRuntime,
		extensionEvents: options.extensionEvents,
		onPrepared: () => options.todoRuntime.flush(),
	});
	const profile: AgentProfile = {
		...options.baseProfile,
		features: [
			...options.baseProfile.features,
			options.productToolFeature,
			...(invokeSkillFeature ? [invokeSkillFeature] : []),
			...(options.subagentRuntime ? [options.subagentRuntime.feature] : []),
		],
		observers: [
			...(options.baseProfile.observers ?? []),
			options.contextRuntime,
			createEcosystemHookTurnObserver(options.hookRuntime),
			...(options.memoryRuntime ? [options.memoryRuntime] : []),
		],
		contextStrategy: options.contextRuntime,
		contextCompositionPublisher: options.contextRuntime,
		modelCallContextTransformer: options.contextRuntime,
		modelCallMessageFinalizer,
		conversationContextProjector: options.conversationContextProjector,
		agentRunPreparer: options.extensionEvents,
		continuationPolicy: continuationOrchestrator,
		modelCallFrameComposer,
		inputRequestPreparer: promptAdapter,
	};
	const capabilities = await RuntimeCapabilityComposition.create({
		initialProfile: profile,
		compiler: options.codingTools.compiler,
		modelBindingProvider: options.modelRuntime,
	});
	return {
		capabilities,
		promptAdapter,
		readAvailableTools,
		readPluginActiveToolNames: () => pluginRunOrchestrator?.readActiveToolNames(),
		reconfigureAgentPluginSkills(agentPlugins) {
			promptResourceSource?.setRuntimeSkillPaths(readPluginSkillPaths(agentPlugins));
		},
		rebindSession(sessionId) {
			pluginSession.id = sessionId;
		},
		async previewInitialSystemPrompt() {
			const sessionId = options.session.readSessionId();
			const operationId = `${sessionId}:extension-context-preview`;
			const signal = new AbortController().signal;
			const initialSnapshotLease = await capabilities.acquire({
				sessionId,
				operationId,
				reason: "preview",
				signal,
			});
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
		dispose: () => capabilities.close(),
	};
}

async function createPromptRuntime(
	options: CodingAgentTurnCapabilitySessionAssemblyOptions,
): Promise<CodingAgentPromptRuntime | undefined> {
	const memoryRuntime = options.memoryRuntime;
	if (options.prompt.systemPromptOptionsResolver) return undefined;
	if (options.prompt.resourceSource && options.prompt.settingsSource) {
		return new CodingAgentPromptRuntime({
			cwd: options.session.cwd,
			resourceLoader: options.prompt.resourceSource,
			settingsManager: options.prompt.settingsSource,
			scenario: options.session.scenario,
			readAgentMode: options.activation.readAgentMode,
			readMemory: memoryRuntime ? () => memoryRuntime.readPromptMemory() : undefined,
			readAgentPlugins: options.activation.readAgentPlugins,
		});
	}
	return createCodingAgentPromptRuntime({
		cwd: options.session.cwd,
		agentDir: options.session.agentDir,
		scenario: options.session.scenario,
		resourceLoaderOptions: {
			includeAgentSkills: options.session.includeAgentSkills,
		},
		readAgentMode: options.activation.readAgentMode,
		readMemory: memoryRuntime ? () => memoryRuntime.readPromptMemory() : undefined,
		readAgentPlugins: options.activation.readAgentPlugins,
	});
}

function readPluginSkillPaths(agentPlugins: AgentPluginRuntimeConfig | undefined): string[] {
	return agentPlugins?.skillPathContributions?.flatMap((contribution) => contribution.paths) ?? [];
}

function toPluginToolActivation(
	activation: CodingToolActivation,
	agentMode: string | undefined,
): CodingAgentPluginToolActivation {
	if (activation.mode === "explicit") return activation;
	return {
		mode: "scope",
		scenario: activation.scope ?? "cli",
		capabilities: activation.capabilities,
		additionallyEnabledToolNames: activation.additionallyEnabledToolNames,
		agentMode,
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
