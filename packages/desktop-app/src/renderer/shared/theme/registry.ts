import type { ActivityPanelFrame } from "@domains/activity-panel/components/activity-panel/ActivityPanelFrame";
import type { LoginPopoverView } from "@domains/auth/components/LoginPopoverView";
import type { AtPanelView } from "@domains/chat/components/at-panel/AtPanelView";
import type { CommandPanelView } from "@domains/chat/components/command-panel/CommandPanelView";
import type { SkillPickerPanelView } from "@domains/chat/components/command-panel/SkillPickerPanel";
import type { ExecutionModeSelectorView } from "@domains/chat/components/execution-mode-selector/ExecutionModeSelectorView";
import type { InputBarView } from "@domains/chat/components/input-bar/InputBarView";
import type { ModelSelectorView } from "@domains/chat/components/model-selector/ModelSelectorView";
import type { SkillCard } from "@domains/chat/components/new-session/SkillCard";
import type { QuestionPanelView } from "@domains/chat/components/question-panel/QuestionPanelView";
import type { FilePreviewDialogView } from "@domains/file-preview/components/FilePreviewDialogView";
import type { KnowledgeDropOverlayView } from "@domains/knowledge-base/components/KnowledgeDropOverlayView";
import type { SidebarNavItemButton } from "@domains/project/components/sidebar/SidebarNavItemButton";
import type { SidebarNavigationProps } from "@domains/project/components/sidebar/SidebarNavigation";
import type { SettingsMenuTrigger } from "@domains/project/components/sidebar/settings-menu/SettingsMenuTrigger";
import type { SidebarRegionProps } from "@domains/project/components/sidebar/types";
import type { AppearanceApprovalDrawerView } from "@shared/action-approval/appearance/AppearanceApprovalDrawerView";
import type { BatchTasksApprovalFrameView } from "@shared/action-approval/batch-tasks/BatchTasksApprovalFrameView";
import type { GenericActionApprovalView } from "@shared/action-approval/GenericActionApprovalView";
import type { ManageActionApprovalFrameView } from "@shared/action-approval/manage/ManageActionApprovalFrameView";
import type { NavigationOpenApprovalView } from "@shared/action-approval/navigation/NavigationOpenApprovalView";
import type { SchedulerActionApprovalDialogView } from "@shared/action-approval/scheduler/SchedulerActionApprovalDialogView";
import type { SchedulerEditApprovalDrawerView } from "@shared/action-approval/scheduler/SchedulerEditApprovalDrawerView";
import type {
	PageHeaderContentProps,
	PageHeaderRegionProps,
	PageHeaderSidebarTrigger,
	PageHeaderTitle,
	PageHeaderWindowActions,
} from "@shared/app-shell/page-header";
import type { WindowControlButton, WindowControlsComponentProps } from "@shared/app-shell/window-controls";
import type { DrawerCard } from "@shared/components/DrawerCard";
import type { UpdateRestartDialogView } from "@shared/components/UpdateRestartDialogView";
import type { ConfirmDialogView } from "@shared/components/ui/ConfirmDialogView";
import type { NewSessionHeroProps } from "@vetta/theme-ui";
import type { ComponentType } from "react";

declare module "@vetta/theme-sdk" {
	interface ThemeRegionRegistry {
		readonly "app.pageHeader"?: ComponentType<PageHeaderRegionProps>;
		readonly sidebar?: ComponentType<SidebarRegionProps>;
	}

	interface ThemeComponentRegistry {
		readonly "activity.panelFrame"?: typeof ActivityPanelFrame;
		readonly "app.mainContentBackground"?: ComponentType;
		readonly "app.pageHeaderContent"?: ComponentType<PageHeaderContentProps>;
		readonly "app.pageHeaderSidebarTrigger"?: typeof PageHeaderSidebarTrigger;
		readonly "app.pageHeaderTitle"?: typeof PageHeaderTitle;
		readonly "app.pageHeaderWindowActions"?: typeof PageHeaderWindowActions;
		readonly "app.windowControls"?: ComponentType<WindowControlsComponentProps>;
		readonly "app.windowControlButton"?: typeof WindowControlButton;
		readonly "chat.atPanelView"?: typeof AtPanelView;
		readonly "chat.executionModeSelectorView"?: typeof ExecutionModeSelectorView;
		readonly "chat.inputDrawer"?: typeof DrawerCard;
		readonly "chat.inputBarView"?: typeof InputBarView;
		readonly "chat.modelSelectorView"?: typeof ModelSelectorView;
		readonly "chat.newSessionBackground"?: ComponentType;
		readonly "chat.newSessionHero"?: ComponentType<NewSessionHeroProps>;
		readonly "chat.newSessionSkillCard"?: typeof SkillCard;
		readonly "chat.questionPanelView"?: typeof QuestionPanelView;
		readonly "chat.commandPanelView"?: typeof CommandPanelView;
		readonly "chat.skillPickerView"?: typeof SkillPickerPanelView;
		readonly "root.approval.appearancePicker"?: ComponentType;
		readonly "root.approval.appearanceDrawerView"?: typeof AppearanceApprovalDrawerView;
		readonly "root.approval.batchTasksExecution"?: ComponentType;
		readonly "root.approval.batchTasksFrameView"?: typeof BatchTasksApprovalFrameView;
		readonly "root.approval.batchTasksProject"?: ComponentType;
		readonly "root.approval.batchTasksTask"?: ComponentType;
		readonly "root.approval.manageFrameView"?: typeof ManageActionApprovalFrameView;
		readonly "root.approval.navigationOpen"?: ComponentType;
		readonly "root.approval.navigationOpenView"?: typeof NavigationOpenApprovalView;
		readonly "root.approval.schedulerCreate"?: ComponentType;
		readonly "root.approval.schedulerActionView"?: typeof SchedulerActionApprovalDialogView;
		readonly "root.approval.schedulerDelete"?: ComponentType;
		readonly "root.approval.schedulerEditView"?: typeof SchedulerEditApprovalDrawerView;
		readonly "root.approval.schedulerExecution"?: ComponentType;
		readonly "root.approval.schedulerToggle"?: ComponentType;
		readonly "root.approval.schedulerUpdate"?: ComponentType;
		readonly "root.approval.themeChange"?: ComponentType;
		readonly "root.confirmDialog"?: ComponentType;
		readonly "root.confirmDialogView"?: typeof ConfirmDialogView;
		readonly "root.filePreviewDialog"?: ComponentType;
		readonly "root.filePreviewDialogView"?: typeof FilePreviewDialogView;
		readonly "root.genericActionApproval"?: ComponentType;
		readonly "root.genericActionApprovalView"?: typeof GenericActionApprovalView;
		readonly "root.knowledgeDropOverlay"?: ComponentType;
		readonly "root.knowledgeDropOverlayView"?: typeof KnowledgeDropOverlayView;
		readonly "root.loginPopover"?: ComponentType;
		readonly "root.loginPopoverView"?: typeof LoginPopoverView;
		readonly "root.toaster"?: ComponentType;
		readonly "root.updateRestartDialog"?: ComponentType;
		readonly "root.updateRestartDialogView"?: typeof UpdateRestartDialogView;
		readonly "sidebar.navItem"?: typeof SidebarNavItemButton;
		readonly "sidebar.navigation"?: ComponentType<SidebarNavigationProps>;
		readonly "sidebar.settingsTrigger"?: typeof SettingsMenuTrigger;
	}
}
