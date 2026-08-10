import type { ThemeSurfaceConfig } from "@vetta/theme-sdk";
import type { ComponentType } from "react";

declare module "@vetta/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "app.mainContentBackground"?: ComponentType;
	}

	interface ThemeSurfaceRegistry {
		readonly "activity.panel"?: ThemeSurfaceConfig;
		readonly "app.frame"?: ThemeSurfaceConfig;
		readonly "app.frameOverlay"?: ThemeSurfaceConfig;
		readonly "app.pageHeader"?: ThemeSurfaceConfig;
		readonly "app.windowControls"?: ThemeSurfaceConfig;
		readonly "chat.atPanel"?: ThemeSurfaceConfig;
		readonly "chat.assistantMessage"?: ThemeSurfaceConfig;
		readonly "chat.executionModeMenu"?: ThemeSurfaceConfig;
		readonly "chat.inputActionBar"?: ThemeSurfaceConfig;
		readonly "chat.inputBar"?: ThemeSurfaceConfig;
		readonly "chat.inputBarToolbarLeft"?: ThemeSurfaceConfig;
		readonly "chat.inputBarToolbarRight"?: ThemeSurfaceConfig;
		readonly "chat.sendButton"?: ThemeSurfaceConfig;
		readonly "chat.inputDrawer"?: ThemeSurfaceConfig;
		readonly "chat.modelSelectorMenu"?: ThemeSurfaceConfig;
		readonly "chat.modelSelectorReasoningMenu"?: ThemeSurfaceConfig;
		readonly "chat.newSessionGuidingWords"?: ThemeSurfaceConfig;
		readonly "chat.newSessionPage"?: ThemeSurfaceConfig;
		readonly "chat.newSessionSceneCard"?: ThemeSurfaceConfig;
		readonly "chat.newSessionSkillCard"?: ThemeSurfaceConfig;
		readonly "chat.questionPanel"?: ThemeSurfaceConfig;
		readonly "chat.sessionViewerPage"?: ThemeSurfaceConfig;
		readonly "chat.slashPanel"?: ThemeSurfaceConfig;
		readonly "chat.todoPanel"?: ThemeSurfaceConfig;
		readonly "chat.view"?: ThemeSurfaceConfig;
		readonly "root.approval.appearance.panel"?: ThemeSurfaceConfig;
		readonly "root.approval.batchTasks.panel"?: ThemeSurfaceConfig;
		readonly "root.approval.manage.panel"?: ThemeSurfaceConfig;
		readonly "root.approval.navigationOpen.panel"?: ThemeSurfaceConfig;
		readonly "root.approval.schedulerAction.panel"?: ThemeSurfaceConfig;
		readonly "root.approval.schedulerEdit.panel"?: ThemeSurfaceConfig;
		readonly "root.confirmDialog.panel"?: ThemeSurfaceConfig;
		readonly "root.filePreviewDialog"?: ThemeSurfaceConfig;
		readonly "root.filePreviewDialog.panel"?: ThemeSurfaceConfig;
		readonly "root.flowingSendDialog.panel"?: ThemeSurfaceConfig;
		readonly "root.genericActionApproval.panel"?: ThemeSurfaceConfig;
		readonly "root.knowledgeDropOverlay"?: ThemeSurfaceConfig;
		readonly "root.loginDialog.panel"?: ThemeSurfaceConfig;
		readonly "root.updateRestartDialog.panel"?: ThemeSurfaceConfig;
		readonly "root.workflowCompleteDialog.panel"?: ThemeSurfaceConfig;
		readonly "settings.pageContent"?: ThemeSurfaceConfig;
		readonly "sidebar.bottomBar"?: ThemeSurfaceConfig;
		readonly "sidebar.messageCenter"?: ThemeSurfaceConfig;
		readonly "sidebar.navigation"?: ThemeSurfaceConfig;
		readonly "sidebar.navigationIndicator"?: ThemeSurfaceConfig;
		readonly "sidebar.panel"?: ThemeSurfaceConfig;
		readonly "sidebar.projects"?: ThemeSurfaceConfig;
		readonly "sidebar.settingsMenu"?: ThemeSurfaceConfig;
		readonly "sidebar.topBar"?: ThemeSurfaceConfig;
	}
}
