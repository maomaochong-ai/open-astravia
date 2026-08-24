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
import { capturePromptResourceSource, capturePromptSettingsSource } from "./prompt-snapshot.js";
import { type CodingAgentModePromptResolver, resolveSystemPromptOptionsFromSources } from "./system-prompt-sources.js";

export type {
	CodingAgentPromptResourceSource,
	CodingAgentPromptSettingsSource,
} from "../runtime-contracts/index.js";

export type CodingAgentPromptMemoryState = CodingAgentMemoryPromptState;

export interface CodingAgentPromptRuntimeOptions {
	readonly cwd: string;
	/**
	 * 由宿主在会话创建前探测并固化的工作区性质事实。
	 * Prompt Runtime 不读取文件系统，避免逐轮探测和平台依赖。
	 */
	readonly workspaceFacts?: string;
	readonly resourceLoader: CodingAgentPromptResourceSource;
	readonly settingsManager: CodingAgentPromptSettingsSource;
	readonly scenario?: ConversationScenario;
	readonly readAgentMode?: () => string | undefined;
	/** 宿主注入的 mode 提示词解析器；缺省 = 不追加 mode block（ADR-0071 修订）。 */
	readonly resolveModePrompt?: CodingAgentModePromptResolver;
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
	private readonly workspaceFacts: string | undefined;

	constructor(private readonly options: CodingAgentPromptRuntimeOptions) {
		this.workspaceFacts = options.workspaceFacts;
		this.resolveSystemPromptOptions = (context) => this.resolve(context);
	}

	async bindForTurn(
		signal?: AbortSignal,
	): Promise<(context: CodingAgentModelCallPromptContext) => CodingAgentSystemPromptOptions> {
		const resourceLoader = await capturePromptResourceSource(this.options.resourceLoader, signal);
		const settingsManager = capturePromptSettingsSource(this.options.settingsManager);
		const agentMode = this.options.readAgentMode?.();
		const memory = this.options.readMemory?.();
		const agentPlugins = this.options.readAgentPlugins?.();
		const runtime = new CodingAgentPromptRuntime({
			...this.options,
			// 显式带走已探测结果，避免每个 Turn 的绑定副本重新做一次 fs 探测。
			workspaceFacts: this.workspaceFacts,
			resourceLoader,
			settingsManager,
			readAgentMode: () => agentMode,
			readMemory: () => memory,
			readAgentPlugins: () => agentPlugins,
		});
		return (context) => runtime.resolve(context);
	}

	resolve(context: CodingAgentModelCallPromptContext): CodingAgentSystemPromptOptions {
		context.signal.throwIfAborted();
		const memory = this.options.readMemory?.();
		const promptOptions = resolveSystemPromptOptionsFromSources({
			toolNames: context.activeToolNames,
			resourceLoader: this.options.resourceLoader,
			mcpManager: undefined,
			cwd: this.options.cwd,
			workspaceFacts: this.workspaceFacts,
			settingsManager: this.options.settingsManager,
			memoryMode: memory?.enabled ?? false,
			memoryFile: memory?.file,
			memorySnapshot: memory?.snapshot ?? "",
			memoryCharLimit: memory?.charLimit ?? 0,
			agentMode: this.options.readAgentMode?.(),
			resolveModePrompt: this.options.resolveModePrompt,
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
