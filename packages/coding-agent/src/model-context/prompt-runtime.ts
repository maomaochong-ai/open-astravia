import type { CodingAgentMemoryPromptState } from "../memory/index.js";
import type { ConversationScenario } from "../profiles/index.js";
import type {
	CodingAgentModelCallPromptContext,
	CodingAgentPromptResourceSource,
	CodingAgentPromptSettingsSource,
	CodingAgentSystemPromptOptionsResolver,
} from "../runtime-contracts/index.js";
import type { CodingAgentSystemPromptOptions } from "./model-call-frame-composer.js";
import type { AgentPluginRuntimeConfig } from "./plugin-runtime.js";
import { resolveSystemPromptOptionsFromSources } from "./system-prompt-sources.js";

export type {
	CodingAgentPromptResourceSource,
	CodingAgentPromptSettingsSource,
} from "../runtime-contracts/index.js";

export type CodingAgentPromptMemoryState = CodingAgentMemoryPromptState;

export interface CodingAgentPromptRuntimeOptions {
	readonly cwd: string;
	readonly resourceLoader: CodingAgentPromptResourceSource;
	readonly settingsManager: CodingAgentPromptSettingsSource;
	readonly scenario?: ConversationScenario;
	readonly readAgentMode?: () => string | undefined;
	readonly readMemory?: () => CodingAgentPromptMemoryState | undefined;
	readonly readAgentPlugins?: () => AgentPluginRuntimeConfig | undefined;
}

/**
 * Coding Agent 的 Session 级 Prompt 事实源。
 *
 * 它只读取当前调用需要的产品状态；Runtime Core 仍只接收最终的模型调用 Frame。
 */
export class CodingAgentPromptRuntime {
	readonly resolveSystemPromptOptions: CodingAgentSystemPromptOptionsResolver;

	constructor(private readonly options: CodingAgentPromptRuntimeOptions) {
		this.resolveSystemPromptOptions = (context) => this.resolve(context);
	}

	resolve(context: CodingAgentModelCallPromptContext): CodingAgentSystemPromptOptions {
		context.signal.throwIfAborted();
		this.options.resourceLoader.refreshSkillsIfChanged();
		this.options.settingsManager.reloadPersonalizationSettings();
		const memory = this.options.readMemory?.();
		const promptOptions = resolveSystemPromptOptionsFromSources({
			toolNames: context.activeToolNames,
			resourceLoader: this.options.resourceLoader,
			mcpManager: undefined,
			cwd: this.options.cwd,
			settingsManager: this.options.settingsManager,
			memoryMode: memory?.enabled ?? false,
			memoryFile: memory?.file,
			memorySnapshot: memory?.snapshot ?? "",
			memoryCharLimit: memory?.charLimit ?? 0,
			agentMode: this.options.readAgentMode?.(),
			agentPlugins: this.options.readAgentPlugins?.(),
			scenario: this.options.scenario,
		});
		const { selectedTools: _selectedTools, ...options } = promptOptions;
		return options;
	}

	readResourceSource(): CodingAgentPromptResourceSource {
		return this.options.resourceLoader;
	}

	readSettingsSource(): CodingAgentPromptSettingsSource {
		return this.options.settingsManager;
	}
}
