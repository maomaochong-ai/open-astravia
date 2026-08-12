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
import { resolveSystemPromptOptionsFromSources } from "./system-prompt-sources.js";
import { detectWorkspaceFacts } from "./workspace-facts.js";

export type {
	CodingAgentPromptResourceSource,
	CodingAgentPromptSettingsSource,
} from "../runtime-contracts/index.js";

export type CodingAgentPromptMemoryState = CodingAgentMemoryPromptState;

export interface CodingAgentPromptRuntimeOptions {
	readonly cwd: string;
	/**
	 * 工作区性质事实。未传时在构造（= 会话创建）时按 cwd 探测一次并在会话内固化，
	 * 保证两个构造点行为一致，也避免逐轮 fs 探测造成前缀缓存抖动。
	 */
	readonly workspaceFacts?: string;
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
	private readonly workspaceFacts: string | undefined;

	constructor(private readonly options: CodingAgentPromptRuntimeOptions) {
		this.workspaceFacts = options.workspaceFacts ?? detectWorkspaceFacts(options.cwd);
		this.resolveSystemPromptOptions = (context) => this.resolve(context);
	}

	bindForTurn(): (context: CodingAgentModelCallPromptContext) => CodingAgentSystemPromptOptions {
		const resourceLoader = capturePromptResourceSource(this.options.resourceLoader);
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
