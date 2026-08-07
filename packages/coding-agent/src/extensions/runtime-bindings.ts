import type { ExtensionActions, ExtensionContextActions, ExtensionRuntime } from "./runtime-contracts.js";

/**
 * Extension 命令式 API 的宿主合同。
 *
 * 它只描述 Extension Runtime 需要的动作，不暴露 AgentSession、SessionManager
 * 或具体 UI。不同宿主必须分别提供真实实现，不能用 no-op 补齐缺口。
 */
export interface ExtensionExecutionHost {
	readonly actions: ExtensionActions;
	readonly contextActions: ExtensionContextActions;
}

/**
 * 将命令式动作绑定到 Loader 创建的共享 Runtime。
 *
 * Extension factory 可以长期保存 ExtensionAPI，因此必须原位更新共享 Runtime，
 * 不能替换对象。
 */
export function bindExtensionRuntimeActions(runtime: ExtensionRuntime, actions: ExtensionActions): void {
	runtime.sendMessage = actions.sendMessage;
	runtime.sendUserMessage = actions.sendUserMessage;
	runtime.appendEntry = actions.appendEntry;
	runtime.setSessionName = actions.setSessionName;
	runtime.getSessionName = actions.getSessionName;
	runtime.setLabel = actions.setLabel;
	runtime.getActiveTools = actions.getActiveTools;
	runtime.getAllTools = actions.getAllTools;
	runtime.setActiveTools = actions.setActiveTools;
	runtime.getCommands = actions.getCommands;
	runtime.setModel = actions.setModel;
	runtime.getThinkingLevel = actions.getThinkingLevel;
	runtime.setThinkingLevel = actions.setThinkingLevel;
}
