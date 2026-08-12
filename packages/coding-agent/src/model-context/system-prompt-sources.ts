import type { ConversationScenario } from "../profiles/index.js";
import { getModePrompt, getPersonaPrompt, sortByAgentModePreference } from "../profiles/index.js";
import type { SessionResourceRuntime } from "../resources/index.js";
import { renderMemoryForPrompt } from "./memory-prompt.js";
import type { AgentPluginRuntimeConfig } from "./plugin-runtime.js";
import type { BuildSystemPromptOptions } from "./product-prompt.js";

export interface PersonalizationSettingsSource {
	getPersonalization(): { personaId: string; customPrompt: string };
}

export type SystemPromptResourceSource = Pick<
	SessionResourceRuntime,
	"getAgentsFiles" | "getAppendSystemPrompt" | "getSkills" | "getSystemPrompt"
>;

export interface SystemPromptMcpSource {
	getTools(): ReadonlyArray<{ readonly name: string; readonly description?: string }>;
}

export interface SystemPromptSourceDependencies {
	toolNames: readonly string[];
	resourceLoader: SystemPromptResourceSource;
	mcpManager: SystemPromptMcpSource | undefined;
	cwd: string;
	/** 会话创建时固化的工作区性质事实；undefined 表示未探测到或探测失败。 */
	workspaceFacts?: string;
	settingsManager: PersonalizationSettingsSource;
	memoryMode: boolean;
	memoryFile: string | undefined;
	memorySnapshot: string;
	memoryCharLimit: number;
	agentMode?: string;
	agentPlugins?: AgentPluginRuntimeConfig;
	scenario?: ConversationScenario;
	mcpDeferred?: boolean;
}

export function buildPersonalizationBlock(settings: PersonalizationSettingsSource): string | undefined {
	const { personaId, customPrompt } = settings.getPersonalization();
	const parts: string[] = [];
	const personaPrompt = getPersonaPrompt(personaId);
	if (personaPrompt.trim()) parts.push(personaPrompt.trim());
	if (customPrompt.trim()) parts.push(customPrompt.trim());
	return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function resolveSystemPromptOptionsFromSources(
	dependencies: SystemPromptSourceDependencies,
): BuildSystemPromptOptions {
	const loaderAppendSystemPrompt = dependencies.resourceLoader.getAppendSystemPrompt();
	// agent_mode 只决定 skill 在清单里的先后顺序，非本模式主推的 skill 仍然列出。
	const loadedSkills = sortByAgentModePreference(
		dependencies.resourceLoader.getSkills().skills,
		dependencies.agentMode,
		(skill) => skill.agentMode,
	);
	const mcpTools =
		dependencies.mcpManager
			?.getTools()
			.filter((tool) => dependencies.mcpDeferred || dependencies.toolNames.includes(tool.name))
			.map((tool) => ({
				name: tool.name,
				description: tool.description || "Tool from MCP server",
			})) ?? [];
	const memory =
		dependencies.memoryMode && dependencies.memoryFile
			? renderMemoryForPrompt(dependencies.memoryFile, dependencies.memorySnapshot, dependencies.memoryCharLimit)
			: undefined;

	return {
		cwd: dependencies.cwd,
		skills: loadedSkills,
		contextFiles: dependencies.resourceLoader.getAgentsFiles().agentsFiles,
		workspaceFacts: dependencies.workspaceFacts,
		customPrompt: dependencies.resourceLoader.getSystemPrompt(),
		appendSystemPrompt: loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : undefined,
		selectedTools: [...dependencies.toolNames],
		mcpTools,
		memory,
		personalization: buildPersonalizationBlock(dependencies.settingsManager),
		modePrompt: getModePrompt(dependencies.agentMode),
		agentPlugins: dependencies.agentPlugins,
		scenario: dependencies.scenario,
		mcpDeferred: dependencies.mcpDeferred,
	};
}
