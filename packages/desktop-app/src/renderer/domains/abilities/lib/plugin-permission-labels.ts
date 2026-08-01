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
	"agent.systemPrompt.read": "permission.agentSystemPromptRead",
	"agent.systemPrompt.write": "permission.agentSystemPromptWrite",
	"agent.systemPrompt.fullControl": "permission.agentSystemPromptFullControl",
	"agent.skills.control": "permission.agentSkillsControl",
	"agent.mcp.control": "permission.agentMcpControl",
	"agent.tools.control": "permission.agentToolsControl",
	"agent.tools.register": "permission.agentToolsRegister",
	"agent.toolHandler.execute": "permission.agentToolHandlerExecute",
	"agent.state.read": "permission.agentStateRead",
	"agent.state.write": "permission.agentStateWrite",
	"agent.continuation.register": "permission.agentContinuationRegister",
	"agent.runtime.configure": "permission.agentRuntimeConfigure",
	"app.actions.register": "permission.appActionsRegister",
	"app.actionHandler.execute": "permission.appActionHandlerExecute",
	"fs.read": "permission.fsRead",
	"fs.write": "permission.fsWrite",
	"network.fetch": "permission.networkFetch",
	"storage.read": "permission.storageRead",
	"storage.write": "permission.storageWrite",
	"settings.read": "permission.settingsRead",
	"settings.write": "permission.settingsWrite",
} as const satisfies Record<PluginPermission, string>;

/** InstalledPlugin.source → i18n key。 */
export function pluginSourceLabelKey(source: "archive" | "remote" | "system") {
	if (source === "remote") return "plugin.source.remote";
	if (source === "system") return "plugin.source.system";
	return "plugin.source.local";
}
