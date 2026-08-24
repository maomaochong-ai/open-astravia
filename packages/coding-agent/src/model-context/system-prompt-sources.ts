import type { ConversationScenario } from "../profiles/index.js";
import { getPersonaPrompt } from "../profiles/index.js";
import type { SessionResourceRuntime } from "../resources/index.js";
import { renderMemoryForPrompt } from "./memory-prompt.js";
import type { AgentPluginRuntimeConfig } from "./plugin-runtime.js";
import type { BuildSystemPromptOptions } from "./system-prompt-policy.js";

/**
 * 工作模式 id → mode 提示词正文的宿主解析器（ADR-0071 修订）。
 *
 * 模式注册表归宿主所有：桌面把 `modes/*.md` 内联成注册表并注入本解析器，CLI / SDK 宿主
 * 不传即等于不追加 `core.mode` block。coding-agent 只认 agentMode 这个不透明 id 与
 * block 槽位，不知道存在哪些模式，也不解释模式语义。
 */
export type CodingAgentModePromptResolver = (agentMode: string | undefined) => string;

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
	/** 宿主注入的 mode 提示词解析器；缺省 = 不追加 mode block。 */
	resolveModePrompt?: CodingAgentModePromptResolver;
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
	// skill 清单在任何工作模式下一致，顺序即加载序（ADR-0071：模式差异只由 modePrompt 承担）。
	const loadedSkills = dependencies.resourceLoader.getSkills().skills;
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
		modePrompt: dependencies.resolveModePrompt?.(dependencies.agentMode) ?? "",
		agentPlugins: dependencies.agentPlugins,
		scenario: dependencies.scenario,
		mcpDeferred: dependencies.mcpDeferred,
	};
}
