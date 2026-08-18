export const APP_MONITOR_SCHEMA_VERSION = 1;

export interface AppMonitorToolStats {
	started: number;
	completed: number;
	failed: number;
	totalDurationMs: number;
}

export interface AppMonitorImageFormatStats {
	count: number;
	totalSizeBytes: number;
}

export interface AppMonitorImageExtremum {
	format: string;
	sizeBytes: number;
	width: number;
	height: number;
	pixels: number;
}

export interface AppMonitorInputActionStats {
	toggles: number;
	activated: number;
	deactivated: number;
}

export interface AppMonitorInputActionUsageStats {
	used: number;
}

export interface AppMonitorPromptRefStats {
	kind: string;
	name: string;
	used: number;
	lastUsedAt: number;
}

export interface AppMonitorResourceKindStats {
	events: number;
	installed: number;
	updated: number;
	imported: number;
	uninstalled: number;
	enabled: number;
	disabled: number;
	reloaded: number;
	permissionGrants: number;
	permissionRevokes: number;
	commandGrants: number;
	commandRevokes: number;
	permissionsChanged: number;
	commandsChanged: number;
}

export interface AppMonitorResourceStats extends AppMonitorResourceKindStats {
	kind: string;
	id: string;
	lastOperation: string;
	lastOperationAt: number;
	source?: string;
	system: boolean;
}

export interface AppMonitorSettingsScopeStats {
	events: number;
	byAction: Record<string, number>;
	byTarget: Record<string, number>;
	byValue: Record<string, number>;
}

export interface AppMonitorSettingsUsageStats {
	tab: string;
	action: string;
	target: string;
	value?: string;
	used: number;
	lastUsedAt: number;
}

export interface AppMonitorData {
	schemaVersion: typeof APP_MONITOR_SCHEMA_VERSION;
	createdAt: number;
	updatedAt: number;
	durations: {
		foregroundActiveMs: number;
		foregroundInactiveMs: number;
		backgroundMs: number;
	};
	sessions: {
		interactive: number;
		batch: number;
		automation: number;
		turns: number;
		messages: number;
	};
	tools: {
		started: number;
		completed: number;
		failed: number;
		totalDurationMs: number;
		byName: Record<string, AppMonitorToolStats>;
	};
	batchTasks: {
		projectsCreated: number;
		runsStarted: number;
	};
	automationTasks: {
		tasksCreated: number;
		runsStarted: number;
	};
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		costTotal: number;
	};
	compactions: {
		started: number;
		succeeded: number;
		failed: number;
	};
	errors: {
		runtime: number;
		provider: number;
		tool: number;
		mcp: number;
	};
	engagement: {
		currentDay: string;
		lastActiveDay: string;
		activeDayStreak: number;
		todayForegroundActiveMs: number;
		todayMessages: number;
		longestConversationTurns: number;
		longestConversationMessages: number;
	};
	knowledgeBase: {
		processingInputTokens: number;
		processingOutputTokens: number;
		processingCacheReadTokens: number;
		processingCacheWriteTokens: number;
		processingCostTotal: number;
		processingRounds: number;
		filesProcessed: number;
		filesFailed: number;
		kbCount: number;
		totalSourceFiles: number;
		wikiPageCount: number;
		manualScanCount: number;
		retryFailedCount: number;
		clearWikiCount: number;
		filesAdded: number;
		filesDeleted: number;
	};
	inputAttachments: {
		events: number;
		bySource: Record<string, number>;
		files: {
			added: number;
			directories: number;
			totalSizeBytes: number;
			byExtension: Record<string, number>;
		};
		images: {
			added: number;
			totalSizeBytes: number;
			byFormat: Record<string, AppMonitorImageFormatStats>;
			largest: AppMonitorImageExtremum | null;
			smallest: AppMonitorImageExtremum | null;
			maxWidth: number;
			maxHeight: number;
			maxPixels: number;
			minWidth: number;
			minHeight: number;
			minPixels: number;
		};
		used: {
			events: number;
			files: {
				used: number;
				directories: number;
				totalSizeBytes: number;
				byExtension: Record<string, number>;
			};
			images: {
				used: number;
				totalSizeBytes: number;
				byFormat: Record<string, AppMonitorImageFormatStats>;
				largest: AppMonitorImageExtremum | null;
				smallest: AppMonitorImageExtremum | null;
				maxWidth: number;
				maxHeight: number;
				maxPixels: number;
				minWidth: number;
				minHeight: number;
				minPixels: number;
			};
		};
	};
	inputActions: {
		events: number;
		activated: number;
		deactivated: number;
		byKind: Record<string, AppMonitorInputActionStats>;
		byAction: Record<string, AppMonitorInputActionStats>;
		used: {
			events: number;
			actions: number;
			byKind: Record<string, AppMonitorInputActionUsageStats>;
			byAction: Record<string, AppMonitorInputActionUsageStats>;
		};
	};
	inputPromptRefs: {
		events: number;
		skills: number;
		scenes: number;
		byKind: Record<string, number>;
		byName: Record<string, number>;
		byRef: Record<string, AppMonitorPromptRefStats>;
		mostUsed: AppMonitorPromptRefStats | null;
		mostUsedSkill: AppMonitorPromptRefStats | null;
		mostUsedScene: AppMonitorPromptRefStats | null;
		recent: AppMonitorPromptRefStats | null;
		recentSkill: AppMonitorPromptRefStats | null;
		recentScene: AppMonitorPromptRefStats | null;
	};
	resources: {
		events: number;
		byKind: Record<string, AppMonitorResourceKindStats>;
		bySource: Record<string, number>;
		byOperation: Record<string, number>;
		byResource: Record<string, AppMonitorResourceStats>;
		mostOperated: AppMonitorResourceStats | null;
		mostOperatedByKind: Record<string, AppMonitorResourceStats>;
		recent: AppMonitorResourceStats | null;
		recentByKind: Record<string, AppMonitorResourceStats>;
	};
	settings: {
		events: number;
		byTab: Record<string, AppMonitorSettingsScopeStats>;
		byAction: Record<string, number>;
		byTarget: Record<string, number>;
		byValue: Record<string, number>;
		byEntry: Record<string, AppMonitorSettingsUsageStats>;
		mostUsed: AppMonitorSettingsUsageStats | null;
		recent: AppMonitorSettingsUsageStats | null;
	};
}

function normalizeCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeAmount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function normalizeDayKey(value: unknown): string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function normalizeToolName(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") return "";
	return trimmed.slice(0, 128);
}

function normalizeToolStats(value: unknown): AppMonitorToolStats {
	const stats = asRecord(value);
	return {
		started: normalizeCount(stats.started),
		completed: normalizeCount(stats.completed),
		failed: normalizeCount(stats.failed),
		totalDurationMs: normalizeCount(stats.totalDurationMs),
	};
}

function normalizeToolStatsByName(value: unknown): Record<string, AppMonitorToolStats> {
	const statsByName: Record<string, AppMonitorToolStats> = {};
	for (const [rawName, rawStats] of Object.entries(asRecord(value))) {
		const toolName = normalizeToolName(rawName);
		if (toolName === "") continue;
		statsByName[toolName] = normalizeToolStats(rawStats);
	}
	return statsByName;
}

function normalizeMetricKey(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim().toLowerCase();
	if (trimmed === "" || trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") return "";
	return trimmed.slice(0, 64);
}

function normalizeCountRecord(value: unknown): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const [rawKey, rawCount] of Object.entries(asRecord(value))) {
		const key = normalizeMetricKey(rawKey);
		if (key === "") continue;
		counts[key] = normalizeCount(rawCount);
	}
	return counts;
}

function normalizeImageFormatStats(value: unknown): AppMonitorImageFormatStats {
	const stats = asRecord(value);
	return {
		count: normalizeCount(stats.count),
		totalSizeBytes: normalizeCount(stats.totalSizeBytes),
	};
}

function normalizeImageFormatStatsByFormat(value: unknown): Record<string, AppMonitorImageFormatStats> {
	const statsByFormat: Record<string, AppMonitorImageFormatStats> = {};
	for (const [rawFormat, rawStats] of Object.entries(asRecord(value))) {
		const format = normalizeMetricKey(rawFormat);
		if (format === "") continue;
		statsByFormat[format] = normalizeImageFormatStats(rawStats);
	}
	return statsByFormat;
}

function normalizeImageExtremum(value: unknown): AppMonitorImageExtremum | null {
	const extremum = asRecord(value);
	const format = normalizeMetricKey(extremum.format);
	const sizeBytes = normalizeCount(extremum.sizeBytes);
	const width = normalizeCount(extremum.width);
	const height = normalizeCount(extremum.height);
	const pixels = normalizeCount(extremum.pixels);
	if (format === "" || (sizeBytes === 0 && width === 0 && height === 0 && pixels === 0)) return null;
	return { format, sizeBytes, width, height, pixels };
}

function normalizeInputActionId(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") return "";
	return trimmed.slice(0, 128);
}

function normalizeInputActionStats(value: unknown): AppMonitorInputActionStats {
	const stats = asRecord(value);
	return {
		toggles: normalizeCount(stats.toggles),
		activated: normalizeCount(stats.activated),
		deactivated: normalizeCount(stats.deactivated),
	};
}

function normalizeInputActionStatsRecord(value: unknown): Record<string, AppMonitorInputActionStats> {
	const statsByKey: Record<string, AppMonitorInputActionStats> = {};
	for (const [rawKey, rawStats] of Object.entries(asRecord(value))) {
		const key = normalizeInputActionId(rawKey);
		if (key === "") continue;
		statsByKey[key] = normalizeInputActionStats(rawStats);
	}
	return statsByKey;
}

function normalizeInputActionUsageStats(value: unknown): AppMonitorInputActionUsageStats {
	const stats = asRecord(value);
	return {
		used: normalizeCount(stats.used),
	};
}

function normalizeInputActionUsageStatsRecord(value: unknown): Record<string, AppMonitorInputActionUsageStats> {
	const statsByKey: Record<string, AppMonitorInputActionUsageStats> = {};
	for (const [rawKey, rawStats] of Object.entries(asRecord(value))) {
		const key = normalizeInputActionId(rawKey);
		if (key === "") continue;
		statsByKey[key] = normalizeInputActionUsageStats(rawStats);
	}
	return statsByKey;
}

function normalizePromptRefStats(value: unknown): AppMonitorPromptRefStats | null {
	const stats = asRecord(value);
	const kind = normalizeMetricKey(stats.kind);
	const name = normalizeMetricKey(stats.name);
	const used = normalizeCount(stats.used);
	const lastUsedAt = normalizeCount(stats.lastUsedAt);
	if ((kind !== "skill" && kind !== "scene") || name === "" || used === 0) return null;
	return {
		kind,
		name,
		used,
		lastUsedAt,
	};
}

function normalizePromptRefStatsRecord(value: unknown): Record<string, AppMonitorPromptRefStats> {
	const statsByKey: Record<string, AppMonitorPromptRefStats> = {};
	for (const [rawKey, rawStats] of Object.entries(asRecord(value))) {
		const key = normalizeInputActionId(rawKey);
		const stats = normalizePromptRefStats(rawStats);
		if (key === "" || !stats) continue;
		statsByKey[key] = stats;
	}
	return statsByKey;
}

function normalizeResourceKindStats(value: unknown): AppMonitorResourceKindStats {
	const stats = asRecord(value);
	return {
		events: normalizeCount(stats.events),
		installed: normalizeCount(stats.installed),
		updated: normalizeCount(stats.updated),
		imported: normalizeCount(stats.imported),
		uninstalled: normalizeCount(stats.uninstalled),
		enabled: normalizeCount(stats.enabled),
		disabled: normalizeCount(stats.disabled),
		reloaded: normalizeCount(stats.reloaded),
		permissionGrants: normalizeCount(stats.permissionGrants),
		permissionRevokes: normalizeCount(stats.permissionRevokes),
		commandGrants: normalizeCount(stats.commandGrants),
		commandRevokes: normalizeCount(stats.commandRevokes),
		permissionsChanged: normalizeCount(stats.permissionsChanged),
		commandsChanged: normalizeCount(stats.commandsChanged),
	};
}

function normalizeResourceKindStatsRecord(value: unknown): Record<string, AppMonitorResourceKindStats> {
	const statsByKey: Record<string, AppMonitorResourceKindStats> = {};
	for (const [rawKey, rawStats] of Object.entries(asRecord(value))) {
		const key = normalizeMetricKey(rawKey);
		if (key === "") continue;
		statsByKey[key] = normalizeResourceKindStats(rawStats);
	}
	return statsByKey;
}

function normalizeResourceId(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") return "";
	return trimmed.slice(0, 128);
}

function normalizeResourceStats(value: unknown): AppMonitorResourceStats | null {
	const stats = asRecord(value);
	const kind = normalizeMetricKey(stats.kind);
	const id = normalizeResourceId(stats.id);
	const lastOperation = normalizeMetricKey(stats.lastOperation);
	const source = normalizeMetricKey(stats.source);
	const base = normalizeResourceKindStats(stats);
	if ((kind !== "skill" && kind !== "scene" && kind !== "plugin") || id === "" || base.events === 0) return null;
	return {
		...base,
		kind,
		id,
		lastOperation,
		lastOperationAt: normalizeCount(stats.lastOperationAt),
		...(source === "" ? {} : { source }),
		system: stats.system === true,
	};
}

function normalizeResourceStatsRecord(value: unknown): Record<string, AppMonitorResourceStats> {
	const statsByKey: Record<string, AppMonitorResourceStats> = {};
	for (const [rawKey, rawStats] of Object.entries(asRecord(value))) {
		const key = normalizeInputActionId(rawKey);
		const stats = normalizeResourceStats(rawStats);
		if (key === "" || !stats) continue;
		statsByKey[key] = stats;
	}
	return statsByKey;
}

function normalizeResourceStatsSnapshot(value: unknown): AppMonitorResourceStats | null {
	const stats = normalizeResourceStats(value);
	return stats ? { ...stats } : null;
}

function normalizeResourceStatsSnapshotRecord(value: unknown): Record<string, AppMonitorResourceStats> {
	const statsByKey: Record<string, AppMonitorResourceStats> = {};
	for (const [rawKey, rawStats] of Object.entries(asRecord(value))) {
		const key = normalizeMetricKey(rawKey);
		const stats = normalizeResourceStats(rawStats);
		if (key === "" || !stats) continue;
		statsByKey[key] = stats;
	}
	return statsByKey;
}

function normalizeSettingsScopeStats(value: unknown): AppMonitorSettingsScopeStats {
	const stats = asRecord(value);
	return {
		events: normalizeCount(stats.events),
		byAction: normalizeCountRecord(stats.byAction),
		byTarget: normalizeCountRecord(stats.byTarget),
		byValue: normalizeCountRecord(stats.byValue),
	};
}

function normalizeSettingsScopeStatsRecord(value: unknown): Record<string, AppMonitorSettingsScopeStats> {
	const statsByKey: Record<string, AppMonitorSettingsScopeStats> = {};
	for (const [rawKey, rawStats] of Object.entries(asRecord(value))) {
		const key = normalizeMetricKey(rawKey);
		if (key === "") continue;
		statsByKey[key] = normalizeSettingsScopeStats(rawStats);
	}
	return statsByKey;
}

function normalizeSettingsUsageStats(value: unknown): AppMonitorSettingsUsageStats | null {
	const stats = asRecord(value);
	const tab = normalizeMetricKey(stats.tab);
	const action = normalizeMetricKey(stats.action);
	const target = normalizeMetricKey(stats.target);
	const valueKey = normalizeMetricKey(stats.value);
	const used = normalizeCount(stats.used);
	if (tab === "" || action === "" || target === "" || used === 0) return null;
	return {
		tab,
		action,
		target,
		...(valueKey === "" ? {} : { value: valueKey }),
		used,
		lastUsedAt: normalizeCount(stats.lastUsedAt),
	};
}

function normalizeSettingsUsageStatsRecord(value: unknown): Record<string, AppMonitorSettingsUsageStats> {
	const statsByKey: Record<string, AppMonitorSettingsUsageStats> = {};
	for (const [rawKey, rawStats] of Object.entries(asRecord(value))) {
		const key = normalizeInputActionId(rawKey);
		const stats = normalizeSettingsUsageStats(rawStats);
		if (key === "" || !stats) continue;
		statsByKey[key] = stats;
	}
	return statsByKey;
}

function formatLocalDayKey(timestamp: number): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function createDefaultAppMonitorData(now = Date.now()): AppMonitorData {
	const currentDay = formatLocalDayKey(now);
	return {
		schemaVersion: APP_MONITOR_SCHEMA_VERSION,
		createdAt: now,
		updatedAt: now,
		durations: {
			foregroundActiveMs: 0,
			foregroundInactiveMs: 0,
			backgroundMs: 0,
		},
		sessions: {
			interactive: 0,
			batch: 0,
			automation: 0,
			turns: 0,
			messages: 0,
		},
		tools: {
			started: 0,
			completed: 0,
			failed: 0,
			totalDurationMs: 0,
			byName: {},
		},
		batchTasks: {
			projectsCreated: 0,
			runsStarted: 0,
		},
		automationTasks: {
			tasksCreated: 0,
			runsStarted: 0,
		},
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costTotal: 0,
		},
		compactions: {
			started: 0,
			succeeded: 0,
			failed: 0,
		},
		errors: {
			runtime: 0,
			provider: 0,
			tool: 0,
			mcp: 0,
		},
		engagement: {
			currentDay,
			lastActiveDay: "",
			activeDayStreak: 0,
			todayForegroundActiveMs: 0,
			todayMessages: 0,
			longestConversationTurns: 0,
			longestConversationMessages: 0,
		},
		knowledgeBase: {
			processingInputTokens: 0,
			processingOutputTokens: 0,
			processingCacheReadTokens: 0,
			processingCacheWriteTokens: 0,
			processingCostTotal: 0,
			processingRounds: 0,
			filesProcessed: 0,
			filesFailed: 0,
			kbCount: 0,
			totalSourceFiles: 0,
			wikiPageCount: 0,
			manualScanCount: 0,
			retryFailedCount: 0,
			clearWikiCount: 0,
			filesAdded: 0,
			filesDeleted: 0,
		},
		inputAttachments: {
			events: 0,
			bySource: {},
			files: {
				added: 0,
				directories: 0,
				totalSizeBytes: 0,
				byExtension: {},
			},
			images: {
				added: 0,
				totalSizeBytes: 0,
				byFormat: {},
				largest: null,
				smallest: null,
				maxWidth: 0,
				maxHeight: 0,
				maxPixels: 0,
				minWidth: 0,
				minHeight: 0,
				minPixels: 0,
			},
			used: {
				events: 0,
				files: {
					used: 0,
					directories: 0,
					totalSizeBytes: 0,
					byExtension: {},
				},
				images: {
					used: 0,
					totalSizeBytes: 0,
					byFormat: {},
					largest: null,
					smallest: null,
					maxWidth: 0,
					maxHeight: 0,
					maxPixels: 0,
					minWidth: 0,
					minHeight: 0,
					minPixels: 0,
				},
			},
		},
		inputActions: {
			events: 0,
			activated: 0,
			deactivated: 0,
			byKind: {},
			byAction: {},
			used: {
				events: 0,
				actions: 0,
				byKind: {},
				byAction: {},
			},
		},
		inputPromptRefs: {
			events: 0,
			skills: 0,
			scenes: 0,
			byKind: {},
			byName: {},
			byRef: {},
			mostUsed: null,
			mostUsedSkill: null,
			mostUsedScene: null,
			recent: null,
			recentSkill: null,
			recentScene: null,
		},
		resources: {
			events: 0,
			byKind: {},
			bySource: {},
			byOperation: {},
			byResource: {},
			mostOperated: null,
			mostOperatedByKind: {},
			recent: null,
			recentByKind: {},
		},
		settings: {
			events: 0,
			byTab: {},
			byAction: {},
			byTarget: {},
			byValue: {},
			byEntry: {},
			mostUsed: null,
			recent: null,
		},
	};
}

export function normalizeAppMonitorData(value: unknown): AppMonitorData {
	const data = asRecord(value);
	const defaults = createDefaultAppMonitorData();
	const durations = asRecord(data.durations);
	const sessions = asRecord(data.sessions);
	const tools = asRecord(data.tools);
	const batchTasks = asRecord(data.batchTasks);
	const automationTasks = asRecord(data.automationTasks);
	const usage = asRecord(data.usage);
	const compactions = asRecord(data.compactions);
	const errors = asRecord(data.errors);
	const engagement = asRecord(data.engagement);
	const knowledgeBase = asRecord(data.knowledgeBase);
	const inputAttachments = asRecord(data.inputAttachments);
	const inputAttachmentFiles = asRecord(inputAttachments.files);
	const inputAttachmentImages = asRecord(inputAttachments.images);
	const inputAttachmentsUsed = asRecord(inputAttachments.used);
	const inputAttachmentsUsedFiles = asRecord(inputAttachmentsUsed.files);
	const inputAttachmentsUsedImages = asRecord(inputAttachmentsUsed.images);
	const inputActions = asRecord(data.inputActions);
	const inputActionsUsed = asRecord(inputActions.used);
	const inputPromptRefs = asRecord(data.inputPromptRefs);
	const inputPromptRefsByRef = normalizePromptRefStatsRecord(inputPromptRefs.byRef);
	const resources = asRecord(data.resources);
	const resourcesByResource = normalizeResourceStatsRecord(resources.byResource);
	const settings = asRecord(data.settings);
	const settingsByEntry = normalizeSettingsUsageStatsRecord(settings.byEntry);

	return {
		schemaVersion: APP_MONITOR_SCHEMA_VERSION,
		createdAt: normalizeCount(data.createdAt) || defaults.createdAt,
		updatedAt: normalizeCount(data.updatedAt) || defaults.updatedAt,
		durations: {
			foregroundActiveMs: normalizeCount(durations.foregroundActiveMs),
			foregroundInactiveMs: normalizeCount(durations.foregroundInactiveMs),
			backgroundMs: normalizeCount(durations.backgroundMs),
		},
		sessions: {
			interactive: normalizeCount(sessions.interactive),
			batch: normalizeCount(sessions.batch),
			automation: normalizeCount(sessions.automation),
			turns: normalizeCount(sessions.turns),
			messages: normalizeCount(sessions.messages),
		},
		tools: {
			started: normalizeCount(tools.started),
			completed: normalizeCount(tools.completed),
			failed: normalizeCount(tools.failed),
			totalDurationMs: normalizeCount(tools.totalDurationMs),
			byName: normalizeToolStatsByName(tools.byName),
		},
		batchTasks: {
			projectsCreated: normalizeCount(batchTasks.projectsCreated),
			runsStarted: normalizeCount(batchTasks.runsStarted),
		},
		automationTasks: {
			tasksCreated: normalizeCount(automationTasks.tasksCreated),
			runsStarted: normalizeCount(automationTasks.runsStarted),
		},
		usage: {
			inputTokens: normalizeCount(usage.inputTokens),
			outputTokens: normalizeCount(usage.outputTokens),
			cacheReadTokens: normalizeCount(usage.cacheReadTokens),
			cacheWriteTokens: normalizeCount(usage.cacheWriteTokens),
			costTotal: normalizeAmount(usage.costTotal),
		},
		compactions: {
			started: normalizeCount(compactions.started),
			succeeded: normalizeCount(compactions.succeeded),
			failed: normalizeCount(compactions.failed),
		},
		errors: {
			runtime: normalizeCount(errors.runtime),
			provider: normalizeCount(errors.provider),
			tool: normalizeCount(errors.tool),
			mcp: normalizeCount(errors.mcp),
		},
		engagement: {
			currentDay: normalizeDayKey(engagement.currentDay) || defaults.engagement.currentDay,
			lastActiveDay: normalizeDayKey(engagement.lastActiveDay),
			activeDayStreak: normalizeCount(engagement.activeDayStreak),
			todayForegroundActiveMs: normalizeCount(engagement.todayForegroundActiveMs),
			todayMessages: normalizeCount(engagement.todayMessages),
			longestConversationTurns: normalizeCount(engagement.longestConversationTurns),
			longestConversationMessages: normalizeCount(engagement.longestConversationMessages),
		},
		knowledgeBase: {
			processingInputTokens: normalizeCount(knowledgeBase.processingInputTokens),
			processingOutputTokens: normalizeCount(knowledgeBase.processingOutputTokens),
			processingCacheReadTokens: normalizeCount(knowledgeBase.processingCacheReadTokens),
			processingCacheWriteTokens: normalizeCount(knowledgeBase.processingCacheWriteTokens),
			processingCostTotal: normalizeAmount(knowledgeBase.processingCostTotal),
			processingRounds: normalizeCount(knowledgeBase.processingRounds),
			filesProcessed: normalizeCount(knowledgeBase.filesProcessed),
			filesFailed: normalizeCount(knowledgeBase.filesFailed),
			kbCount: normalizeCount(knowledgeBase.kbCount),
			totalSourceFiles: normalizeCount(knowledgeBase.totalSourceFiles),
			wikiPageCount: normalizeCount(knowledgeBase.wikiPageCount),
			manualScanCount: normalizeCount(knowledgeBase.manualScanCount),
			retryFailedCount: normalizeCount(knowledgeBase.retryFailedCount),
			clearWikiCount: normalizeCount(knowledgeBase.clearWikiCount),
			filesAdded: normalizeCount(knowledgeBase.filesAdded),
			filesDeleted: normalizeCount(knowledgeBase.filesDeleted),
		},
		inputAttachments: {
			events: normalizeCount(inputAttachments.events),
			bySource: normalizeCountRecord(inputAttachments.bySource),
			files: {
				added: normalizeCount(inputAttachmentFiles.added),
				directories: normalizeCount(inputAttachmentFiles.directories),
				totalSizeBytes: normalizeCount(inputAttachmentFiles.totalSizeBytes),
				byExtension: normalizeCountRecord(inputAttachmentFiles.byExtension),
			},
			images: {
				added: normalizeCount(inputAttachmentImages.added),
				totalSizeBytes: normalizeCount(inputAttachmentImages.totalSizeBytes),
				byFormat: normalizeImageFormatStatsByFormat(inputAttachmentImages.byFormat),
				largest: normalizeImageExtremum(inputAttachmentImages.largest),
				smallest: normalizeImageExtremum(inputAttachmentImages.smallest),
				maxWidth: normalizeCount(inputAttachmentImages.maxWidth),
				maxHeight: normalizeCount(inputAttachmentImages.maxHeight),
				maxPixels: normalizeCount(inputAttachmentImages.maxPixels),
				minWidth: normalizeCount(inputAttachmentImages.minWidth),
				minHeight: normalizeCount(inputAttachmentImages.minHeight),
				minPixels: normalizeCount(inputAttachmentImages.minPixels),
			},
			used: {
				events: normalizeCount(inputAttachmentsUsed.events),
				files: {
					used: normalizeCount(inputAttachmentsUsedFiles.used),
					directories: normalizeCount(inputAttachmentsUsedFiles.directories),
					totalSizeBytes: normalizeCount(inputAttachmentsUsedFiles.totalSizeBytes),
					byExtension: normalizeCountRecord(inputAttachmentsUsedFiles.byExtension),
				},
				images: {
					used: normalizeCount(inputAttachmentsUsedImages.used),
					totalSizeBytes: normalizeCount(inputAttachmentsUsedImages.totalSizeBytes),
					byFormat: normalizeImageFormatStatsByFormat(inputAttachmentsUsedImages.byFormat),
					largest: normalizeImageExtremum(inputAttachmentsUsedImages.largest),
					smallest: normalizeImageExtremum(inputAttachmentsUsedImages.smallest),
					maxWidth: normalizeCount(inputAttachmentsUsedImages.maxWidth),
					maxHeight: normalizeCount(inputAttachmentsUsedImages.maxHeight),
					maxPixels: normalizeCount(inputAttachmentsUsedImages.maxPixels),
					minWidth: normalizeCount(inputAttachmentsUsedImages.minWidth),
					minHeight: normalizeCount(inputAttachmentsUsedImages.minHeight),
					minPixels: normalizeCount(inputAttachmentsUsedImages.minPixels),
				},
			},
		},
		inputActions: {
			events: normalizeCount(inputActions.events),
			activated: normalizeCount(inputActions.activated),
			deactivated: normalizeCount(inputActions.deactivated),
			byKind: normalizeInputActionStatsRecord(inputActions.byKind),
			byAction: normalizeInputActionStatsRecord(inputActions.byAction),
			used: {
				events: normalizeCount(inputActionsUsed.events),
				actions: normalizeCount(inputActionsUsed.actions),
				byKind: normalizeInputActionUsageStatsRecord(inputActionsUsed.byKind),
				byAction: normalizeInputActionUsageStatsRecord(inputActionsUsed.byAction),
			},
		},
		inputPromptRefs: {
			events: normalizeCount(inputPromptRefs.events),
			skills: normalizeCount(inputPromptRefs.skills),
			scenes: normalizeCount(inputPromptRefs.scenes),
			byKind: normalizeCountRecord(inputPromptRefs.byKind),
			byName: normalizeCountRecord(inputPromptRefs.byName),
			byRef: inputPromptRefsByRef,
			mostUsed: normalizePromptRefStats(inputPromptRefs.mostUsed) ?? findMostUsedPromptRef(inputPromptRefsByRef),
			mostUsedSkill:
				normalizePromptRefStats(inputPromptRefs.mostUsedSkill) ??
				findMostUsedPromptRef(inputPromptRefsByRef, "skill"),
			mostUsedScene:
				normalizePromptRefStats(inputPromptRefs.mostUsedScene) ??
				findMostUsedPromptRef(inputPromptRefsByRef, "scene"),
			recent: normalizePromptRefStats(inputPromptRefs.recent) ?? findRecentPromptRef(inputPromptRefsByRef),
			recentSkill:
				normalizePromptRefStats(inputPromptRefs.recentSkill) ?? findRecentPromptRef(inputPromptRefsByRef, "skill"),
			recentScene:
				normalizePromptRefStats(inputPromptRefs.recentScene) ?? findRecentPromptRef(inputPromptRefsByRef, "scene"),
		},
		resources: {
			events: normalizeCount(resources.events),
			byKind: normalizeResourceKindStatsRecord(resources.byKind),
			bySource: normalizeCountRecord(resources.bySource),
			byOperation: normalizeCountRecord(resources.byOperation),
			byResource: resourcesByResource,
			mostOperated:
				normalizeResourceStatsSnapshot(resources.mostOperated) ?? findMostOperatedResource(resourcesByResource),
			mostOperatedByKind: {
				...findMostOperatedResourcesByKind(resourcesByResource),
				...normalizeResourceStatsSnapshotRecord(resources.mostOperatedByKind),
			},
			recent: normalizeResourceStatsSnapshot(resources.recent) ?? findRecentResource(resourcesByResource),
			recentByKind: {
				...findRecentResourcesByKind(resourcesByResource),
				...normalizeResourceStatsSnapshotRecord(resources.recentByKind),
			},
		},
		settings: {
			events: normalizeCount(settings.events),
			byTab: normalizeSettingsScopeStatsRecord(settings.byTab),
			byAction: normalizeCountRecord(settings.byAction),
			byTarget: normalizeCountRecord(settings.byTarget),
			byValue: normalizeCountRecord(settings.byValue),
			byEntry: settingsByEntry,
			mostUsed: normalizeSettingsUsageStats(settings.mostUsed) ?? findMostUsedSettingsEntry(settingsByEntry),
			recent: normalizeSettingsUsageStats(settings.recent) ?? findRecentSettingsEntry(settingsByEntry),
		},
	};
}

function findMostUsedPromptRef(
	statsByKey: Record<string, AppMonitorPromptRefStats>,
	kind?: string,
): AppMonitorPromptRefStats | null {
	let selected: AppMonitorPromptRefStats | null = null;
	for (const stats of Object.values(statsByKey)) {
		if (kind && stats.kind !== kind) continue;
		if (
			!selected ||
			stats.used > selected.used ||
			(stats.used === selected.used && stats.lastUsedAt > selected.lastUsedAt)
		) {
			selected = stats;
		}
	}
	return selected ? { ...selected } : null;
}

function findRecentPromptRef(
	statsByKey: Record<string, AppMonitorPromptRefStats>,
	kind?: string,
): AppMonitorPromptRefStats | null {
	let selected: AppMonitorPromptRefStats | null = null;
	for (const stats of Object.values(statsByKey)) {
		if (kind && stats.kind !== kind) continue;
		if (!selected || stats.lastUsedAt > selected.lastUsedAt) {
			selected = stats;
		}
	}
	return selected ? { ...selected } : null;
}

function findMostOperatedResource(
	statsByKey: Record<string, AppMonitorResourceStats>,
	kind?: string,
): AppMonitorResourceStats | null {
	let selected: AppMonitorResourceStats | null = null;
	for (const stats of Object.values(statsByKey)) {
		if (kind && stats.kind !== kind) continue;
		if (
			!selected ||
			stats.events > selected.events ||
			(stats.events === selected.events && stats.lastOperationAt > selected.lastOperationAt)
		) {
			selected = stats;
		}
	}
	return selected ? { ...selected } : null;
}

function findRecentResource(
	statsByKey: Record<string, AppMonitorResourceStats>,
	kind?: string,
): AppMonitorResourceStats | null {
	let selected: AppMonitorResourceStats | null = null;
	for (const stats of Object.values(statsByKey)) {
		if (kind && stats.kind !== kind) continue;
		if (!selected || stats.lastOperationAt > selected.lastOperationAt) {
			selected = stats;
		}
	}
	return selected ? { ...selected } : null;
}

function findMostOperatedResourcesByKind(
	statsByKey: Record<string, AppMonitorResourceStats>,
): Record<string, AppMonitorResourceStats> {
	const result: Record<string, AppMonitorResourceStats> = {};
	for (const kind of ["skill", "scene", "plugin"]) {
		const stats = findMostOperatedResource(statsByKey, kind);
		if (stats) result[kind] = stats;
	}
	return result;
}

function findRecentResourcesByKind(
	statsByKey: Record<string, AppMonitorResourceStats>,
): Record<string, AppMonitorResourceStats> {
	const result: Record<string, AppMonitorResourceStats> = {};
	for (const kind of ["skill", "scene", "plugin"]) {
		const stats = findRecentResource(statsByKey, kind);
		if (stats) result[kind] = stats;
	}
	return result;
}

function findMostUsedSettingsEntry(
	statsByKey: Record<string, AppMonitorSettingsUsageStats>,
): AppMonitorSettingsUsageStats | null {
	let selected: AppMonitorSettingsUsageStats | null = null;
	for (const stats of Object.values(statsByKey)) {
		if (
			!selected ||
			stats.used > selected.used ||
			(stats.used === selected.used && stats.lastUsedAt > selected.lastUsedAt)
		) {
			selected = stats;
		}
	}
	return selected ? { ...selected } : null;
}

function findRecentSettingsEntry(
	statsByKey: Record<string, AppMonitorSettingsUsageStats>,
): AppMonitorSettingsUsageStats | null {
	let selected: AppMonitorSettingsUsageStats | null = null;
	for (const stats of Object.values(statsByKey)) {
		if (!selected || stats.lastUsedAt > selected.lastUsedAt) selected = stats;
	}
	return selected ? { ...selected } : null;
}
