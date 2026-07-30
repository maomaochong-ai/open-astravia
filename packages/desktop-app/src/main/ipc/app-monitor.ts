import { ipcMain } from "electron";
import type {
	AppMonitorEvent,
	AppMonitorInputActionKind,
	AppMonitorInputActionUsage,
	AppMonitorInputAttachmentSource,
	AppMonitorInputFileAttachment,
	AppMonitorInputImageAttachment,
	AppMonitorInputPromptRefKind,
	AppMonitorInputPromptRefUsage,
	AppMonitorResourceKind,
	AppMonitorResourceOperation,
	AppMonitorResourceSource,
	AppMonitorSettingsAction,
	AppMonitorSettingsTab,
} from "../../preload/api-types/app-monitor.js";
import {
	getAppMonitorSnapshot,
	recordAppMonitorEvent,
	recordAppMonitorUserActivity,
} from "../app-monitor/app-monitor-service.js";
import { captureProductEvent } from "../telemetry/index.js";

const USER_ACTIVITY_CHANNEL = "vetta:app-monitor:user-activity";
const RECORD_EVENT_CHANNEL = "vetta:app-monitor:record-event";
const GET_ACHIEVEMENT_USAGE_CHANNEL = "vetta:app-monitor:get-achievement-usage";
const GET_PROMPT_REF_USAGE_CHANNEL = "vetta:app-monitor:get-prompt-ref-usage";

const INPUT_ATTACHMENT_SOURCES = new Set<AppMonitorInputAttachmentSource>([
	"at-panel",
	"file-dialog",
	"image-dialog",
	"drop",
	"paste",
]);
const INPUT_ACTION_KINDS = new Set<AppMonitorInputActionKind>(["builtin", "plugin"]);
const INPUT_PROMPT_REF_KINDS = new Set<AppMonitorInputPromptRefKind>(["scene", "skill"]);
const RESOURCE_KINDS = new Set<AppMonitorResourceKind>(["skill", "scene", "plugin"]);
const RESOURCE_OPERATIONS = new Set<AppMonitorResourceOperation>([
	"installed",
	"updated",
	"imported",
	"uninstalled",
	"enabled",
	"disabled",
	"reloaded",
	"permissions-granted",
	"permissions-revoked",
	"commands-granted",
	"commands-revoked",
]);
const RESOURCE_SOURCES = new Set<AppMonitorResourceSource>(["market", "custom", "archive", "remote", "system"]);
const SETTINGS_TABS = new Set<AppMonitorSettingsTab>([
	"general",
	"appearance",
	"account",
	"agent",
	"models",
	"mcp",
	"im",
	"webhook",
	"shortcuts",
	"appshot",
	"environment",
	"permissions",
	"knowledge",
	"pet",
	"plugins",
	"archived",
	"subscription",
	"newSession",
]);
const SETTINGS_ACTIONS = new Set<AppMonitorSettingsAction>([
	"selected",
	"changed",
	"saved",
	"added",
	"updated",
	"deleted",
	"enabled",
	"disabled",
	"reset",
	"restored",
	"tested",
	"scanned",
	"retried",
	"cleared",
	"imported",
	"reinstalled",
	"refreshed",
]);

export function registerAppMonitorIpc(): () => void {
	const onUserActivity = (): void => {
		recordAppMonitorUserActivity();
	};
	const onRecordEvent = (_event: Electron.IpcMainEvent, payload: unknown): void => {
		const event = toAppMonitorEvent(payload);
		if (!event) return;
		recordAppMonitorEvent(event);
		captureProductEvent(event);
	};
	ipcMain.on(USER_ACTIVITY_CHANNEL, onUserActivity);
	ipcMain.on(RECORD_EVENT_CHANNEL, onRecordEvent);
	ipcMain.handle(GET_ACHIEVEMENT_USAGE_CHANNEL, () => {
		const snapshot = getAppMonitorSnapshot();
		return {
			activeDayStreak: snapshot.engagement.activeDayStreak,
			automationRuns: snapshot.automationTasks.runsStarted,
			batchRuns: snapshot.batchTasks.runsStarted,
			foregroundActiveMs: snapshot.durations.foregroundActiveMs,
			interactiveSessions: snapshot.sessions.interactive,
			knowledgeBaseCount: snapshot.knowledgeBase.kbCount,
			knowledgeBaseFileOperations: snapshot.knowledgeBase.filesAdded + snapshot.knowledgeBase.filesDeleted,
			longestConversationMessages: snapshot.engagement.longestConversationMessages,
			longestConversationTurns: snapshot.engagement.longestConversationTurns,
			messages: snapshot.sessions.messages,
			projectsCreated: snapshot.batchTasks.projectsCreated,
			todayActiveMs: snapshot.engagement.todayForegroundActiveMs,
			todayMessages: snapshot.engagement.todayMessages,
			toolsCompleted: snapshot.tools.completed,
			totalTokens: snapshot.usage.inputTokens + snapshot.usage.outputTokens,
			turns: snapshot.sessions.turns,
		};
	});
	// 命令面板的「按使用频次排序」：把已落盘的 per-skill 统计原样交给渲染层，
	// 只保留排序需要的 used / lastUsedAt 两个字段。
	ipcMain.handle(GET_PROMPT_REF_USAGE_CHANNEL, () => {
		const byRef = getAppMonitorSnapshot().inputPromptRefs.byRef;
		const usage: Record<string, { used: number; lastUsedAt: number }> = {};
		for (const [key, stats] of Object.entries(byRef)) {
			usage[key] = { used: stats.used, lastUsedAt: stats.lastUsedAt };
		}
		return usage;
	});
	return () => {
		ipcMain.removeListener(USER_ACTIVITY_CHANNEL, onUserActivity);
		ipcMain.removeListener(RECORD_EVENT_CHANNEL, onRecordEvent);
		ipcMain.removeHandler(GET_ACHIEVEMENT_USAGE_CHANNEL);
		ipcMain.removeHandler(GET_PROMPT_REF_USAGE_CHANNEL);
	};
}

function toAppMonitorEvent(value: unknown): AppMonitorEvent | null {
	if (!isRecord(value)) return null;
	if (value.type === "settings.changed") return toSettingsChangedEvent(value);
	if (value.type === "resource.lifecycle") return toResourceLifecycleEvent(value);
	if (value.type === "input.context.used") return toInputContextUsedEvent(value);
	if (value.type === "input.action.used") return toInputActionUsedEvent(value);
	if (value.type === "input.action.toggled") return toInputActionToggledEvent(value);
	if (value.type !== "input.attachments.added") return null;
	if (!isInputAttachmentSource(value.source)) return null;
	const files = Array.isArray(value.files) ? value.files.map(toFileAttachment).filter((item) => item !== null) : [];
	const images = Array.isArray(value.images)
		? value.images.map(toImageAttachment).filter((item) => item !== null)
		: [];
	if (files.length === 0 && images.length === 0) return null;
	return {
		type: "input.attachments.added",
		source: value.source,
		files,
		images,
	};
}

function toSettingsChangedEvent(value: Record<string, unknown>): AppMonitorEvent | null {
	if (!isSettingsTab(value.tab) || !isSettingsAction(value.action)) return null;
	const target = normalizeKey(value.target);
	const eventValue = normalizeOptionalKey(value.value);
	if (target === "unknown") return null;
	return {
		type: "settings.changed",
		tab: value.tab,
		action: value.action,
		target,
		...(eventValue ? { value: eventValue } : {}),
	};
}

function toResourceLifecycleEvent(value: Record<string, unknown>): AppMonitorEvent | null {
	if (!isResourceKind(value.resourceKind) || !isResourceOperation(value.operation)) return null;
	const resourceId = normalizeName(value.resourceId);
	if (resourceId === "") return null;
	const source = isResourceSource(value.source) ? value.source : undefined;
	const permissionCount = normalizeOptionalCount(value.permissionCount);
	const commandCount = normalizeOptionalCount(value.commandCount);
	return {
		type: "resource.lifecycle",
		resourceKind: value.resourceKind,
		operation: value.operation,
		resourceId,
		...(source ? { source } : {}),
		...(typeof value.system === "boolean" ? { system: value.system } : {}),
		...(permissionCount === undefined ? {} : { permissionCount }),
		...(commandCount === undefined ? {} : { commandCount }),
	};
}

function toInputContextUsedEvent(value: Record<string, unknown>): AppMonitorEvent | null {
	const files = Array.isArray(value.files) ? value.files.map(toFileAttachment).filter((item) => item !== null) : [];
	const images = Array.isArray(value.images)
		? value.images.map(toImageAttachment).filter((item) => item !== null)
		: [];
	const promptRef = toInputPromptRefUsage(value.promptRef);
	if (files.length === 0 && images.length === 0 && !promptRef) return null;
	return {
		type: "input.context.used",
		files,
		images,
		...(promptRef ? { promptRef } : {}),
	};
}

function toInputActionUsedEvent(value: Record<string, unknown>): AppMonitorEvent | null {
	if (!Array.isArray(value.actions)) return null;
	const actions = value.actions.map(toInputActionUsage).filter((item) => item !== null);
	if (actions.length === 0) return null;
	return {
		type: "input.action.used",
		actions,
	};
}

function toInputActionToggledEvent(value: Record<string, unknown>): AppMonitorEvent | null {
	if (!isInputActionKind(value.actionKind) || typeof value.active !== "boolean") return null;
	const actionId = normalizeActionId(value.actionId);
	if (actionId === "") return null;
	return {
		type: "input.action.toggled",
		actionId,
		actionKind: value.actionKind,
		active: value.active,
	};
}

function toInputActionUsage(value: unknown): AppMonitorInputActionUsage | null {
	if (!isRecord(value) || !isInputActionKind(value.actionKind)) return null;
	const actionId = normalizeActionId(value.actionId);
	if (actionId === "") return null;
	return {
		actionId,
		actionKind: value.actionKind,
	};
}

function toInputPromptRefUsage(value: unknown): AppMonitorInputPromptRefUsage | undefined {
	if (!isRecord(value) || !isInputPromptRefKind(value.kind)) return undefined;
	const name = normalizeName(value.name);
	if (name === "") return undefined;
	return {
		kind: value.kind,
		name,
	};
}

function toFileAttachment(value: unknown): AppMonitorInputFileAttachment | null {
	if (!isRecord(value) || typeof value.isDirectory !== "boolean") return null;
	const extension = normalizeKey(value.extension);
	const sizeBytes = normalizeOptionalCount(value.sizeBytes);
	return {
		extension,
		isDirectory: value.isDirectory,
		...(sizeBytes === undefined ? {} : { sizeBytes }),
	};
}

function toImageAttachment(value: unknown): AppMonitorInputImageAttachment | null {
	if (!isRecord(value)) return null;
	const format = normalizeKey(value.format);
	const sizeBytes = normalizeOptionalCount(value.sizeBytes);
	const width = normalizeOptionalCount(value.width);
	const height = normalizeOptionalCount(value.height);
	return {
		format,
		...(sizeBytes === undefined ? {} : { sizeBytes }),
		...(width === undefined ? {} : { width }),
		...(height === undefined ? {} : { height }),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInputAttachmentSource(value: unknown): value is AppMonitorInputAttachmentSource {
	return typeof value === "string" && INPUT_ATTACHMENT_SOURCES.has(value as AppMonitorInputAttachmentSource);
}

function isInputActionKind(value: unknown): value is AppMonitorInputActionKind {
	return typeof value === "string" && INPUT_ACTION_KINDS.has(value as AppMonitorInputActionKind);
}

function isInputPromptRefKind(value: unknown): value is AppMonitorInputPromptRefKind {
	return typeof value === "string" && INPUT_PROMPT_REF_KINDS.has(value as AppMonitorInputPromptRefKind);
}

function isResourceKind(value: unknown): value is AppMonitorResourceKind {
	return typeof value === "string" && RESOURCE_KINDS.has(value as AppMonitorResourceKind);
}

function isResourceOperation(value: unknown): value is AppMonitorResourceOperation {
	return typeof value === "string" && RESOURCE_OPERATIONS.has(value as AppMonitorResourceOperation);
}

function isResourceSource(value: unknown): value is AppMonitorResourceSource {
	return typeof value === "string" && RESOURCE_SOURCES.has(value as AppMonitorResourceSource);
}

function isSettingsTab(value: unknown): value is AppMonitorSettingsTab {
	return typeof value === "string" && SETTINGS_TABS.has(value as AppMonitorSettingsTab);
}

function isSettingsAction(value: unknown): value is AppMonitorSettingsAction {
	return typeof value === "string" && SETTINGS_ACTIONS.has(value as AppMonitorSettingsAction);
}

function normalizeKey(value: unknown): string {
	if (typeof value !== "string") return "unknown";
	const normalized = value.trim().toLowerCase();
	if (normalized === "" || normalized === "__proto__" || normalized === "prototype" || normalized === "constructor") {
		return "unknown";
	}
	return normalized.slice(0, 64);
}

function normalizeOptionalKey(value: unknown): string | undefined {
	const normalized = normalizeKey(value);
	return normalized === "unknown" ? undefined : normalized;
}

function normalizeActionId(value: unknown): string {
	if (typeof value !== "string") return "";
	const normalized = value.trim();
	if (normalized === "" || normalized === "__proto__" || normalized === "prototype" || normalized === "constructor") {
		return "";
	}
	return normalized.slice(0, 128);
}

function normalizeName(value: unknown): string {
	if (typeof value !== "string") return "";
	const normalized = value.trim();
	if (normalized === "" || normalized === "__proto__" || normalized === "prototype" || normalized === "constructor") {
		return "";
	}
	return normalized.slice(0, 128);
}

function normalizeOptionalCount(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.floor(value);
}
