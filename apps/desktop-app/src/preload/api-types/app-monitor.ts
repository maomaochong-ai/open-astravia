export interface AchievementUsageStats {
	activeDayStreak: number;
	automationRuns: number;
	batchRuns: number;
	foregroundActiveMs: number;
	interactiveSessions: number;
	knowledgeBaseCount: number;
	knowledgeBaseFileOperations: number;
	longestConversationMessages: number;
	longestConversationTurns: number;
	messages: number;
	projectsCreated: number;
	todayActiveMs: number;
	todayMessages: number;
	toolsCompleted: number;
	totalTokens: number;
	turns: number;
}

export type AppMonitorInputAttachmentSource = "at-panel" | "file-dialog" | "image-dialog" | "drop" | "paste";

export interface AppMonitorInputFileAttachment {
	extension: string;
	isDirectory: boolean;
	sizeBytes?: number;
}

export interface AppMonitorInputImageAttachment {
	format: string;
	sizeBytes?: number;
	width?: number;
	height?: number;
}

export type AppMonitorInputActionKind = "builtin" | "plugin";

export interface AppMonitorInputActionUsage {
	actionId: string;
	actionKind: AppMonitorInputActionKind;
}

export type AppMonitorInputPromptRefKind = "scene" | "skill";

export interface AppMonitorInputPromptRefUsage {
	kind: AppMonitorInputPromptRefKind;
	name: string;
}

export type AppMonitorResourceKind = "skill" | "scene" | "plugin";

export type AppMonitorResourceOperation =
	| "installed"
	| "updated"
	| "imported"
	| "uninstalled"
	| "enabled"
	| "disabled"
	| "reloaded"
	| "permissions-granted"
	| "permissions-revoked"
	| "commands-granted"
	| "commands-revoked";

export type AppMonitorResourceSource = "market" | "custom" | "archive" | "remote" | "npm" | "system";

export type AppMonitorSettingsTab =
	| "general"
	| "appearance"
	| "account"
	| "agent"
	| "models"
	| "mcp"
	| "im"
	| "webhook"
	| "shortcuts"
	| "appshot"
	| "environment"
	| "permissions"
	| "knowledge"
	| "pet"
	| "plugins"
	| "archived"
	| "subscription"
	| "newSession";

export type AppMonitorSettingsAction =
	| "selected"
	| "changed"
	| "saved"
	| "added"
	| "updated"
	| "deleted"
	| "enabled"
	| "disabled"
	| "reset"
	| "restored"
	| "tested"
	| "scanned"
	| "retried"
	| "cleared"
	| "imported"
	| "reinstalled"
	| "refreshed";

export type AppMonitorEvent =
	| {
			type: "input.attachments.added";
			source: AppMonitorInputAttachmentSource;
			files?: AppMonitorInputFileAttachment[];
			images?: AppMonitorInputImageAttachment[];
	  }
	| {
			type: "input.action.toggled";
			actionId: string;
			actionKind: AppMonitorInputActionKind;
			active: boolean;
	  }
	| {
			type: "input.action.used";
			actions: AppMonitorInputActionUsage[];
	  }
	| {
			type: "input.context.used";
			files?: AppMonitorInputFileAttachment[];
			images?: AppMonitorInputImageAttachment[];
			promptRef?: AppMonitorInputPromptRefUsage;
	  }
	| {
			type: "resource.lifecycle";
			resourceKind: AppMonitorResourceKind;
			operation: AppMonitorResourceOperation;
			resourceId: string;
			source?: AppMonitorResourceSource;
			system?: boolean;
			permissionCount?: number;
			commandCount?: number;
	  }
	| {
			type: "settings.changed";
			tab: AppMonitorSettingsTab;
			action: AppMonitorSettingsAction;
			target: string;
			value?: string;
	  };

/** 单个 skill / 场景的历史使用情况。 */
export interface AppMonitorPromptRefUsage {
	used: number;
	lastUsedAt: number;
}

/**
 * 按 `kind:name` 归集的使用统计。key 里的 name 经过归一化（小写 + 截断），
 * 调用方比对时必须同样小写化。
 */
export type AppMonitorPromptRefUsageMap = Record<string, AppMonitorPromptRefUsage>;

export interface DesktopAppMonitorApi {
	getAchievementUsage(): Promise<AchievementUsageStats>;
	/** 命令面板按使用频次排序用；读的是已落盘的 inputPromptRefs.byRef。 */
	getPromptRefUsage(): Promise<AppMonitorPromptRefUsageMap>;
	recordEvent(event: AppMonitorEvent): void;
}
