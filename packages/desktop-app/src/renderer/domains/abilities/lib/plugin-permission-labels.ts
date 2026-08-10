import type { PluginPermission } from "@preload/api";

/**
 * 插件权限的展示文案：模块级常量只存 i18n key（abilities ns），渲染期用 t() 解析。
 * 权限清单以 zip 内 plugin.json 为唯一真相源（ADR-0049 对 ADR-0019 的刻意例外）。
 */
export const PLUGIN_PERMISSION_LABEL_KEYS = {
	"ui.slot.global": "permission.uiSlotGlobal",
	"ui.slot.file-preview": "permission.uiSlotFilePreview",
	"ui.slot.activity-tab": "permission.uiSlotActivityTab",
	"ui.slot.input-action": "permission.uiSlotInputAction",
	"ui.slot.message": "permission.uiSlotMessage",
	"ui.slot.tool-call": "permission.uiSlotToolCall",
	"ui.slot.turn-card": "permission.uiSlotTurnCard",
	"ui.shortcuts.register": "permission.uiShortcutsRegister",
	"ui.file-explorer.decorations": "permission.uiFileExplorerDecorations",
	"ui.file-explorer.context-menu": "permission.uiFileExplorerContextMenu",
	"ui.file-explorer.toolbar": "permission.uiFileExplorerToolbar",
	"workspace.read": "permission.workspaceRead",
	"agent.session.read": "permission.agentSessionRead",
	"agent.session.write": "permission.agentSessionWrite",
	"agent.command.run": "permission.agentCommandRun",
	"agent.command.spawn": "permission.agentCommandSpawn",
	"capture.offscreen": "permission.captureOffscreen",
	"agent.systemPrompt.read": "permission.agentSystemPromptRead",
	"agent.systemPrompt.write": "permission.agentSystemPromptWrite",
	"agent.systemPrompt.fullControl": "permission.agentSystemPromptFullControl",
	"agent.skills.control": "permission.agentSkillsControl",
	"agent.mcp.control": "permission.agentMcpControl",
	"agent.tools.control": "permission.agentToolsControl",
	"agent.tools.register": "permission.agentToolsRegister",
	"agent.toolHandler.execute": "permission.agentToolHandlerExecute",
	"agent.hooks.register": "permission.agentHooksRegister",
	"agent.hookHandler.execute": "permission.agentHookHandlerExecute",
	"agent.state.read": "permission.agentStateRead",
	"agent.state.write": "permission.agentStateWrite",
	"agent.continuation.register": "permission.agentContinuationRegister",
	"agent.runtime.configure": "permission.agentRuntimeConfigure",
	"app.actions.register": "permission.appActionsRegister",
	"app.actionHandler.execute": "permission.appActionHandlerExecute",
	"ai.models.list": "permission.aiModelsList",
	"ai.complete": "permission.aiComplete",
	"fs.read": "permission.fsRead",
	"fs.write": "permission.fsWrite",
	"network.fetch": "permission.networkFetch",
	"storage.read": "permission.storageRead",
	"storage.write": "permission.storageWrite",
	"media.generate": "permission.mediaGenerate",
	"media.provider.register": "permission.mediaProviderRegister",
	"settings.read": "permission.settingsRead",
	"settings.write": "permission.settingsWrite",
	"shell.openExternal": "permission.shellOpenExternal",
} as const satisfies Record<PluginPermission, string>;

export type PluginPermissionGroup = "interface" | "projectData" | "agent" | "execution" | "intelligence";
export type PluginPermissionRisk = "low" | "medium" | "high";
export type PluginPermissionVisualKind = "interface" | "data" | "agent" | "execution" | "external" | "intelligence";
export type PluginUiPreview =
	| "global"
	| "filePreview"
	| "activityTab"
	| "inputAction"
	| "message"
	| "toolCall"
	| "turnCard"
	| "shortcuts"
	| "fileDecorations"
	| "fileContextMenu"
	| "fileToolbar";

interface PluginPermissionPresentation {
	descriptionKey: string;
	group: PluginPermissionGroup;
	risk: PluginPermissionRisk;
	visual: PluginPermissionVisualKind;
	uiPreview?: PluginUiPreview;
}

export const PLUGIN_PERMISSION_GROUPS: readonly PluginPermissionGroup[] = [
	"interface",
	"projectData",
	"agent",
	"execution",
	"intelligence",
];

/** 宿主维护的权限边界说明。插件只能申请权限，不能改写这里的解释与风险等级。 */
export const PLUGIN_PERMISSION_PRESENTATIONS = {
	"ui.slot.global": {
		descriptionKey: "permission.description.uiSlotGlobal",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "global",
	},
	"ui.slot.file-preview": {
		descriptionKey: "permission.description.uiSlotFilePreview",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "filePreview",
	},
	"ui.slot.activity-tab": {
		descriptionKey: "permission.description.uiSlotActivityTab",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "activityTab",
	},
	"ui.slot.input-action": {
		descriptionKey: "permission.description.uiSlotInputAction",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "inputAction",
	},
	"ui.slot.message": {
		descriptionKey: "permission.description.uiSlotMessage",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "message",
	},
	"ui.slot.tool-call": {
		descriptionKey: "permission.description.uiSlotToolCall",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "toolCall",
	},
	"ui.slot.turn-card": {
		descriptionKey: "permission.description.uiSlotTurnCard",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "turnCard",
	},
	"ui.shortcuts.register": {
		descriptionKey: "permission.description.uiShortcutsRegister",
		group: "interface",
		risk: "medium",
		visual: "interface",
		uiPreview: "shortcuts",
	},
	"ui.file-explorer.decorations": {
		descriptionKey: "permission.description.uiFileExplorerDecorations",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "fileDecorations",
	},
	"ui.file-explorer.context-menu": {
		descriptionKey: "permission.description.uiFileExplorerContextMenu",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "fileContextMenu",
	},
	"ui.file-explorer.toolbar": {
		descriptionKey: "permission.description.uiFileExplorerToolbar",
		group: "interface",
		risk: "low",
		visual: "interface",
		uiPreview: "fileToolbar",
	},
	"workspace.read": {
		descriptionKey: "permission.description.workspaceRead",
		group: "projectData",
		risk: "medium",
		visual: "data",
	},
	"fs.read": { descriptionKey: "permission.description.fsRead", group: "projectData", risk: "high", visual: "data" },
	"fs.write": { descriptionKey: "permission.description.fsWrite", group: "projectData", risk: "high", visual: "data" },
	"storage.read": {
		descriptionKey: "permission.description.storageRead",
		group: "projectData",
		risk: "low",
		visual: "data",
	},
	"storage.write": {
		descriptionKey: "permission.description.storageWrite",
		group: "projectData",
		risk: "low",
		visual: "data",
	},
	"settings.read": {
		descriptionKey: "permission.description.settingsRead",
		group: "projectData",
		risk: "medium",
		visual: "data",
	},
	"settings.write": {
		descriptionKey: "permission.description.settingsWrite",
		group: "projectData",
		risk: "high",
		visual: "data",
	},
	"agent.session.read": {
		descriptionKey: "permission.description.agentSessionRead",
		group: "agent",
		risk: "medium",
		visual: "agent",
	},
	"agent.session.write": {
		descriptionKey: "permission.description.agentSessionWrite",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.systemPrompt.read": {
		descriptionKey: "permission.description.agentSystemPromptRead",
		group: "agent",
		risk: "medium",
		visual: "agent",
	},
	"agent.systemPrompt.write": {
		descriptionKey: "permission.description.agentSystemPromptWrite",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.systemPrompt.fullControl": {
		descriptionKey: "permission.description.agentSystemPromptFullControl",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.skills.control": {
		descriptionKey: "permission.description.agentSkillsControl",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.mcp.control": {
		descriptionKey: "permission.description.agentMcpControl",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.tools.control": {
		descriptionKey: "permission.description.agentToolsControl",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.tools.register": {
		descriptionKey: "permission.description.agentToolsRegister",
		group: "agent",
		risk: "medium",
		visual: "agent",
	},
	"agent.toolHandler.execute": {
		descriptionKey: "permission.description.agentToolHandlerExecute",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.hooks.register": {
		descriptionKey: "permission.description.agentHooksRegister",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.hookHandler.execute": {
		descriptionKey: "permission.description.agentHookHandlerExecute",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.state.read": {
		descriptionKey: "permission.description.agentStateRead",
		group: "agent",
		risk: "medium",
		visual: "agent",
	},
	"agent.state.write": {
		descriptionKey: "permission.description.agentStateWrite",
		group: "agent",
		risk: "medium",
		visual: "agent",
	},
	"agent.continuation.register": {
		descriptionKey: "permission.description.agentContinuationRegister",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.runtime.configure": {
		descriptionKey: "permission.description.agentRuntimeConfigure",
		group: "agent",
		risk: "high",
		visual: "agent",
	},
	"agent.command.run": {
		descriptionKey: "permission.description.agentCommandRun",
		group: "execution",
		risk: "high",
		visual: "execution",
	},
	"agent.command.spawn": {
		descriptionKey: "permission.description.agentCommandSpawn",
		group: "execution",
		risk: "high",
		visual: "execution",
	},
	"capture.offscreen": {
		descriptionKey: "permission.description.captureOffscreen",
		group: "execution",
		risk: "medium",
		visual: "execution",
	},
	"app.actions.register": {
		descriptionKey: "permission.description.appActionsRegister",
		group: "execution",
		risk: "low",
		visual: "execution",
	},
	"app.actionHandler.execute": {
		descriptionKey: "permission.description.appActionHandlerExecute",
		group: "execution",
		risk: "medium",
		visual: "execution",
	},
	"network.fetch": {
		descriptionKey: "permission.description.networkFetch",
		group: "execution",
		risk: "high",
		visual: "external",
	},
	"shell.openExternal": {
		descriptionKey: "permission.description.shellOpenExternal",
		group: "execution",
		risk: "medium",
		visual: "external",
	},
	"ai.models.list": {
		descriptionKey: "permission.description.aiModelsList",
		group: "intelligence",
		risk: "low",
		visual: "intelligence",
	},
	"ai.complete": {
		descriptionKey: "permission.description.aiComplete",
		group: "intelligence",
		risk: "high",
		visual: "intelligence",
	},
	"media.generate": {
		descriptionKey: "permission.description.mediaGenerate",
		group: "intelligence",
		risk: "medium",
		visual: "intelligence",
	},
	"media.provider.register": {
		descriptionKey: "permission.description.mediaProviderRegister",
		group: "intelligence",
		risk: "medium",
		visual: "intelligence",
	},
} as const satisfies Record<PluginPermission, PluginPermissionPresentation>;

/** InstalledPlugin.source → i18n key。 */
export function pluginSourceLabelKey(source: "archive" | "remote" | "system") {
	if (source === "remote") return "plugin.source.remote";
	if (source === "system") return "plugin.source.system";
	return "plugin.source.local";
}
