import { join } from "node:path";
import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import {
	type CodingAgentHtmlExportRuntime,
	createToolHtmlRenderer,
	type ToolHtmlRenderer,
} from "../../export-html/index.js";
import { DEFAULT_MEMORY_CHAR_LIMIT } from "../../memory/index.js";
import type { CodingAgentModelRuntime } from "../../models/index.js";
import { theme } from "../../modes/interactive/theme/theme.js";
import type { CreateCodingAgentSessionOptions } from "../../public-api/sdk/index.js";
import type { SessionResourceRuntime } from "../../resources/index.js";
import { createCodingAgentSessionSetupSeedInitializer } from "../../sessions/setup/session-setup-seed-initializer.js";
import type { SettingsRuntime } from "../../settings/index.js";
import { CodingAgentSdkBashAdapter } from "../coding-agent-sdk-bash-adapter.js";
import type { CodingAgentSdkExtensionTransitionAdapter } from "../coding-agent-sdk-extension-transition-adapter.js";
import {
	type CodingAgentSdkResourceSourceAdapter,
	projectCodingAgentSkillInfo,
} from "../coding-agent-sdk-resource-source-adapter.js";
import { createHostBashExecutor } from "../command-execution/index.js";
import { CodingAgentResourceReloadHost } from "../resources/resource-reload-host.js";
import { CodingAgentBranchNavigationHost } from "../session-history/branch-navigation-host.js";
import { CodingAgentGreenfieldSdkActiveSessionCapabilityHost } from "./active-session-capability-host.js";
import { adaptPublicCodingAgentSdkCustomTools } from "./custom-tool-adapter.js";
import type {
	GreenfieldSdkActiveSessionCapabilityHostFactory,
	GreenfieldSdkSessionCapabilityHostFactory,
} from "./runtime-factory.js";
import { CodingAgentGreenfieldSessionCapabilityHost } from "./session-capability-host.js";

export interface CodingAgentSdkSessionCapabilityFactoriesOptions {
	readonly sdkOptions: CreateCodingAgentSessionOptions;
	readonly cwd: string;
	readonly settingsManager: SettingsRuntime;
	readonly modelRegistry: CodingAgentModelRuntime;
	readonly resourceLoader: SessionResourceRuntime;
	readonly resourceSourceAdapter?: CodingAgentSdkResourceSourceAdapter;
	readonly extensionTransitions: CodingAgentSdkExtensionTransitionAdapter;
	readonly htmlExporter: CodingAgentHtmlExportRuntime;
	readonly readAgentPlugins: () => CreateCodingAgentSessionOptions["agentPlugins"];
	readonly setAgentPlugins: (agentPlugins: CreateCodingAgentSessionOptions["agentPlugins"]) => void;
}

export function createCodingAgentSdkSessionCapabilityHostFactory(
	options: CodingAgentSdkSessionCapabilityFactoriesOptions,
): GreenfieldSdkSessionCapabilityHostFactory {
	return ({ readSession, composition }) => {
		const reloadHost = new CodingAgentResourceReloadHost({
			settingsManager: options.settingsManager,
			resourceLoader: options.resourceLoader,
			runWithExtensionLifecycle: (operation) =>
				options.extensionTransitions.reload(readSession(), composition, operation),
			afterReload: () => {
				const currentExtensions = options.resourceLoader.getExtensions();
				for (const { name, config } of currentExtensions.runtime.pendingProviderRegistrations) {
					options.modelRegistry.registerProvider(name, config);
				}
				currentExtensions.runtime.pendingProviderRegistrations = [];
				composition.refreshExtensionTools(currentExtensions.extensions);
			},
		});
		const applyResourceSourcePaths = () => {
			if (!options.resourceSourceAdapter) return;
			options.resourceLoader.setAdditionalExtensionPaths([...options.resourceSourceAdapter.readExtensionPaths()]);
			options.resourceLoader.setAdditionalSkillPaths([
				...(options.readAgentPlugins()?.skillPathContributions?.flatMap((contribution) => contribution.paths) ??
					[]),
				...options.resourceSourceAdapter.readSkillPaths(),
			]);
		};
		const refreshInvalidatedResourceSources = async () => {
			if (!options.resourceSourceAdapter) return;
			const refreshed = await options.resourceSourceAdapter.refreshInvalidated();
			if (!refreshed.skillsChanged && !refreshed.extensionsChanged) return;
			applyResourceSourcePaths();
			if (refreshed.extensionsChanged) await reloadHost.reload();
			else options.resourceLoader.reloadSkills();
		};
		return new CodingAgentGreenfieldSessionCapabilityHost({
			readSession,
			beforePrompt: refreshInvalidatedResourceSources,
			readAvailableModels: async () => options.modelRegistry.getAvailable(),
			scopedModels: options.sdkOptions.scopedModels,
			initialAgentMode: options.sdkOptions.agentMode,
			settings: options.settingsManager,
			reconfigureCustomTools: (customTools) =>
				composition.replaceSessionTools(
					readSession().sessionId,
					adaptPublicCodingAgentSdkCustomTools(customTools) ?? [],
				),
			readSystemPrompt: () => options.extensionTransitions.readSystemPrompt(),
			readSkills: () => options.resourceLoader.getSkills().skills.map(projectCodingAgentSkillInfo),
			readPromptTemplates: () => options.resourceLoader.getPrompts().prompts,
			reconfigureAgentPlugins: (agentPlugins) => {
				options.setAgentPlugins(agentPlugins);
				options.resourceLoader.setAdditionalSkillPaths([
					...(agentPlugins?.skillPathContributions?.flatMap((contribution) => contribution.paths) ?? []),
					...(options.resourceSourceAdapter?.readSkillPaths() ?? options.sdkOptions.resources?.skillPaths ?? []),
				]);
			},
			memoryConfiguration: {
				enabled: options.sdkOptions.memoryMode ?? false,
				file:
					options.sdkOptions.memoryFile ??
					(options.sdkOptions.memoryMode ? join(options.cwd, "MEMORY.md") : undefined),
				charLimit: options.sdkOptions.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT,
			},
			flushMemory: (signal) => composition.flushMemory(readSession().sessionId, signal),
			reloadMcp: () => composition.reloadMcp(readSession().sessionId),
			reload: async () => {
				await options.resourceSourceAdapter?.refreshAll();
				applyResourceSourcePaths();
				await reloadHost.reload();
			},
			exportToHtml: (outputPath) =>
				exportCodingAgentSdkSessionToHtml(
					readSession(),
					options.htmlExporter,
					options.settingsManager.getTheme(),
					options.extensionTransitions.readRunnerOrUndefined(),
					options.extensionTransitions.readSystemPrompt(),
					outputPath,
				),
			hasExtensionHandlers: (eventType) => options.extensionTransitions.hasHandlers(eventType),
		});
	};
}

export function createCodingAgentSdkActiveSessionCapabilityHostFactory(
	options: Pick<CodingAgentSdkSessionCapabilityFactoriesOptions, "extensionTransitions" | "settingsManager">,
): GreenfieldSdkActiveSessionCapabilityHostFactory {
	return ({ sessionHost, composition }) => {
		const bash = new CodingAgentSdkBashAdapter({
			executor: createHostBashExecutor(),
			readShellCommandPrefix: () => options.settingsManager.getShellCommandPrefix(),
		});
		bash.bindEvents(sessionHost);
		const treeNavigation = new CodingAgentBranchNavigationHost({
			withActiveSession: (operation) => sessionHost.runActiveSessionMutation(operation),
			readRunner: () => options.extensionTransitions.readRunner(),
			settingsManager: options.settingsManager,
			clearExecutionContext: (sessionId) => composition.clearSessionExecutionContext(sessionId),
		});
		return new CodingAgentGreenfieldSdkActiveSessionCapabilityHost({
			sessionHost,
			bash,
			treeNavigation,
			createSessionSetupInitializer: createCodingAgentSessionSetupSeedInitializer,
		});
	};
}

async function exportCodingAgentSdkSessionToHtml(
	session: GreenfieldRuntimeSession,
	htmlExporter: CodingAgentHtmlExportRuntime,
	themeName: string | undefined,
	runner: ReturnType<CodingAgentSdkExtensionTransitionAdapter["readRunnerOrUndefined"]>,
	systemPrompt: string,
	outputPath?: string,
): Promise<string> {
	const core = session.createCoreAssembly();
	const sessionFile = core.lifecycle.sessionPath;
	if (!sessionFile) throw new Error("Cannot export in-memory session to HTML");
	let toolRenderer: ToolHtmlRenderer | undefined;
	if (runner) {
		toolRenderer = createToolHtmlRenderer({
			getToolDefinition: (name) => runner.getToolDefinition(name),
			theme,
		});
	}
	const availableTools = core.toolController?.readAvailableTools();
	return htmlExporter.exportConversation(core.conversationView.readDocument(), sessionFile, {
		outputPath,
		themeName,
		toolRenderer,
		systemPrompt,
		tools: availableTools
			? [...availableTools.values()].map((tool) => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.inputSchema,
				}))
			: undefined,
	});
}
