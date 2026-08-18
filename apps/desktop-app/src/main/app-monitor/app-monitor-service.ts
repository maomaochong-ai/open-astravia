import type { RuntimeHost, SessionEvent } from "@vetta/runtime-core";
import type { AppMonitorEvent, AppMonitorInputImageAttachment } from "../../preload/api-types/app-monitor.js";
import { getAppLogger } from "../logger.js";
import { formatDayKey, getDayBounds, getPreviousDayKey, getPreviousMonthKey } from "./app-monitor-calendar.js";
import { type AppMonitorData, createDefaultAppMonitorData } from "./app-monitor-data.js";
import {
	type AppMonitorDayBucket,
	type AppMonitorMonthData,
	createDefaultAppMonitorMonthData,
	getAppMonitorMonthKey,
	getOrCreateAppMonitorDayBucket,
} from "./app-monitor-month-data.js";
import { type AppMonitorProfile, createDefaultAppMonitorProfile } from "./app-monitor-profile.js";
import { appMonitorProfileStore, appMonitorStore, createAppMonitorMonthStore } from "./app-monitor-store.js";
import { runAppMonitorFileMigrations } from "./migrations/index.js";

const ACTIVE_TIMEOUT_MS = 2 * 60 * 1000;
const FLUSH_INTERVAL_MS = 2 * 60 * 1000;
const log = getAppLogger("app-monitor");

export type MonitoredSessionKind = "interactive" | "batch" | "automation";

export interface KnowledgeBaseMonitorSnapshot {
	kbCount: number;
	totalSourceFiles: number;
	wikiPageCount: number;
}

export interface KnowledgeBaseProcessingUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costTotal: number;
}

interface SessionEngagementStats {
	turns: number;
	messages: number;
}

class AppMonitorService {
	private data = createDefaultAppMonitorData();
	private profile: AppMonitorProfile = createDefaultAppMonitorProfile();
	private readonly months = new Map<string, AppMonitorMonthData>();
	private readonly persistedMonthRevisions = new Map<string, number>();
	private initialized = false;
	private visible = false;
	private lastActivityAt = Date.now();
	private lastAccountedAt = Date.now();
	private revision = 0;
	private persistedRevision = 0;
	private flushTimer: ReturnType<typeof setInterval> | undefined;
	private flushPromise: Promise<void> | undefined;
	private readonly runtimeSubscriptions = new Map<string, () => void>();
	private readonly sessionStats = new Map<string, SessionEngagementStats>();
	private readonly dailySessionStats = new Map<string, SessionEngagementStats>();

	async initialize(): Promise<void> {
		if (this.initialized) return;
		try {
			await runAppMonitorFileMigrations(log);
		} catch (error) {
			log.warn("file migration failed", error);
		}
		try {
			this.profile = await appMonitorProfileStore.read();
			await appMonitorProfileStore.write(this.profile);
		} catch (error) {
			log.warn("profile initialization failed, using in-memory defaults", error);
		}
		try {
			this.data = await appMonitorStore.read();
		} catch (error) {
			log.warn("summary initialization failed, using in-memory defaults", error);
		}
		const now = Date.now();
		const monthKeys = new Set([
			getAppMonitorMonthKey(now, this.profile),
			getPreviousMonthKey(now, this.profile.reportingTimeZone),
		]);
		for (const monthKey of monthKeys) {
			try {
				const month = await createAppMonitorMonthStore(monthKey, this.profile).read();
				this.months.set(monthKey, month);
				this.persistedMonthRevisions.set(monthKey, month.revision);
			} catch (error) {
				log.warn("monthly data initialization failed, using in-memory defaults", { month: monthKey }, error);
			}
		}
		this.lastActivityAt = now;
		this.lastAccountedAt = now;
		this.initialized = true;
		this.ensureDayBucket(now);
		this.ensureEngagementDay(now);
		this.flushTimer = setInterval(() => {
			void this.flush();
		}, FLUSH_INTERVAL_MS);
		this.flushTimer.unref?.();
	}

	setWindowVisible(visible: boolean): void {
		const now = Date.now();
		this.accountDuration(now);
		this.visible = visible;
		if (visible) this.lastActivityAt = now;
	}

	recordUserActivity(): void {
		const now = Date.now();
		this.accountDuration(now);
		this.lastActivityAt = now;
	}

	recordEvent(event: AppMonitorEvent): void {
		const now = Date.now();
		this.mutate((data) => {
			switch (event.type) {
				case "input.attachments.added":
					recordInputAttachmentsAdded(data, event);
					break;
				case "input.action.toggled":
					recordInputActionToggled(data, event);
					break;
				case "input.action.used":
					recordInputActionUsed(data, event);
					break;
				case "input.context.used":
					recordInputContextUsed(data, event, now);
					break;
				case "resource.lifecycle":
					recordResourceLifecycle(data, event, now);
					break;
				case "settings.changed":
					recordSettingsChanged(data, event, now);
					break;
			}
		}, now);
	}

	recordBatchProjectCreated(): void {
		this.mutate((data) => {
			data.batchTasks.projectsCreated += 1;
		});
	}

	recordBatchRunStarted(): void {
		this.mutate((data) => {
			data.batchTasks.runsStarted += 1;
		});
	}

	recordAutomationTaskCreated(): void {
		this.mutate((data) => {
			data.automationTasks.tasksCreated += 1;
		});
	}

	recordAutomationRunStarted(): void {
		this.mutate((data) => {
			data.automationTasks.runsStarted += 1;
		});
	}

	recordKnowledgeBaseManualScan(): void {
		this.mutate((data) => {
			data.knowledgeBase.manualScanCount += 1;
		});
	}

	recordKnowledgeBaseRetryFailed(): void {
		this.mutate((data) => {
			data.knowledgeBase.retryFailedCount += 1;
		});
	}

	recordKnowledgeBaseClearWiki(): void {
		this.mutate((data) => {
			data.knowledgeBase.clearWikiCount += 1;
		});
	}

	recordKnowledgeBaseFilesAdded(count: number): void {
		const normalized = normalizeDelta(count);
		if (normalized === 0) return;
		this.mutate((data) => {
			data.knowledgeBase.filesAdded += normalized;
		});
	}

	recordKnowledgeBaseFilesDeleted(count: number): void {
		const normalized = normalizeDelta(count);
		if (normalized === 0) return;
		this.mutate((data) => {
			data.knowledgeBase.filesDeleted += normalized;
		});
	}

	recordKnowledgeBaseProcessingRound(): void {
		this.mutate((data) => {
			data.knowledgeBase.processingRounds += 1;
		});
	}

	recordKnowledgeBaseProcessingUsage(usage: KnowledgeBaseProcessingUsage): void {
		this.mutate((data) => {
			data.knowledgeBase.processingInputTokens += normalizeDelta(usage.inputTokens);
			data.knowledgeBase.processingOutputTokens += normalizeDelta(usage.outputTokens);
			data.knowledgeBase.processingCacheReadTokens += normalizeDelta(usage.cacheReadTokens);
			data.knowledgeBase.processingCacheWriteTokens += normalizeDelta(usage.cacheWriteTokens);
			data.knowledgeBase.processingCostTotal += normalizeAmountDelta(usage.costTotal);
		});
	}

	recordKnowledgeBaseProcessingResult(filesProcessed: number, filesFailed: number): void {
		const processed = normalizeDelta(filesProcessed);
		const failed = normalizeDelta(filesFailed);
		if (processed === 0 && failed === 0) return;
		this.mutate((data) => {
			data.knowledgeBase.filesProcessed += processed;
			data.knowledgeBase.filesFailed += failed;
		});
	}

	recordKnowledgeBaseSnapshot(snapshot: KnowledgeBaseMonitorSnapshot): void {
		this.mutate((data) => {
			data.knowledgeBase.kbCount = normalizeDelta(snapshot.kbCount);
			data.knowledgeBase.totalSourceFiles = normalizeDelta(snapshot.totalSourceFiles);
			data.knowledgeBase.wikiPageCount = normalizeDelta(snapshot.wikiPageCount);
		});
	}

	getSnapshot(): AppMonitorData {
		const now = Date.now();
		this.accountDuration(now);
		this.ensureEngagementDay(now);
		return structuredClone(this.data);
	}

	monitorSession(runtime: RuntimeHost, sessionId: string, kind: MonitoredSessionKind): void {
		this.mutate((data) => {
			data.sessions[kind] += 1;
		});
		if (this.runtimeSubscriptions.has(sessionId)) return;

		try {
			const unsubscribe = runtime.subscribe(sessionId, (event: SessionEvent) => {
				try {
					this.recordSessionEvent(event);
				} catch (error) {
					log.warn("runtime event recording failed", { sessionId, type: event.type }, error);
				}
			});
			this.runtimeSubscriptions.set(sessionId, unsubscribe);
		} catch (error) {
			log.warn("runtime subscription failed", { sessionId }, error);
		}
	}

	stopMonitoringSession(sessionId: string): void {
		const unsubscribe = this.runtimeSubscriptions.get(sessionId);
		if (!unsubscribe) return;
		try {
			unsubscribe();
		} catch (error) {
			log.warn("runtime unsubscribe failed", { sessionId }, error);
		}
		this.runtimeSubscriptions.delete(sessionId);
		this.sessionStats.delete(sessionId);
		for (const key of this.dailySessionStats.keys()) {
			if (key.endsWith(`\0${sessionId}`)) this.dailySessionStats.delete(key);
		}
	}

	async flush(): Promise<void> {
		this.accountDuration(Date.now());
		const dirtyMonths = [...this.months.entries()].filter(
			([monthKey, month]) => month.revision !== this.persistedMonthRevisions.get(monthKey),
		);
		if (this.revision === this.persistedRevision && dirtyMonths.length === 0) return;
		if (this.flushPromise) {
			await this.flushPromise;
			if (
				this.revision !== this.persistedRevision ||
				[...this.months.entries()].some(
					([monthKey, month]) => month.revision !== this.persistedMonthRevisions.get(monthKey),
				)
			) {
				await this.flush();
			}
			return;
		}

		const snapshot = this.revision === this.persistedRevision ? undefined : structuredClone(this.data);
		const snapshotRevision = this.revision;
		const monthSnapshots = dirtyMonths.map(([monthKey, month]) => ({
			monthKey,
			revision: month.revision,
			snapshot: structuredClone(month),
		}));
		const writes: Promise<void>[] = [];
		if (snapshot) writes.push(appMonitorStore.write(snapshot));
		for (const month of monthSnapshots) {
			writes.push(createAppMonitorMonthStore(month.monthKey, this.profile).write(month.snapshot));
		}
		this.flushPromise = Promise.all(writes)
			.then(() => {
				if (snapshot) this.persistedRevision = Math.max(this.persistedRevision, snapshotRevision);
				for (const month of monthSnapshots) {
					this.persistedMonthRevisions.set(
						month.monthKey,
						Math.max(this.persistedMonthRevisions.get(month.monthKey) ?? 0, month.revision),
					);
				}
			})
			.catch((error: unknown) => {
				log.warn("periodic flush failed", error);
			})
			.finally(() => {
				this.flushPromise = undefined;
			});
		return this.flushPromise;
	}

	async shutdown(): Promise<void> {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = undefined;
		}
		for (const sessionId of [...this.runtimeSubscriptions.keys()]) {
			this.stopMonitoringSession(sessionId);
		}
		await this.flush();
	}

	private accountDuration(now: number): void {
		if (!this.initialized || now <= this.lastAccountedAt) return;
		const from = this.lastAccountedAt;
		this.lastAccountedAt = now;

		if (!this.visible) {
			this.addDuration("backgroundMs", from, now);
			return;
		}

		const activeUntil = this.lastActivityAt + ACTIVE_TIMEOUT_MS;
		const activeEnd = Math.min(now, Math.max(from, activeUntil));
		if (activeEnd > from) {
			this.addDuration("foregroundActiveMs", from, activeEnd);
		}
		if (now > activeEnd) {
			this.addDuration("foregroundInactiveMs", activeEnd, now);
		}
	}

	private addDuration(key: keyof AppMonitorData["durations"], from: number, to: number): void {
		if (to <= from) return;
		let cursor = from;
		while (cursor < to) {
			const nextBoundary = Math.min(to, getDayBounds(cursor, this.profile.reportingTimeZone).endUtc);
			const durationMs = nextBoundary - cursor;
			if (durationMs <= 0) break;
			this.mutate((data) => {
				data.durations[key] += durationMs;
				if (key === "foregroundActiveMs") {
					markActiveDay(data, cursor, this.profile.reportingTimeZone);
					data.engagement.todayForegroundActiveMs += durationMs;
				}
			}, cursor);
			cursor = nextBoundary;
		}
	}

	private recordSessionEvent(event: SessionEvent): void {
		switch (event.type) {
			case "session.lifecycle":
				if (event.phase === "turn_start") this.recordSessionTurn(event.sessionId, event.timestamp);
				break;
			case "message.final":
				this.recordSessionMessage(event.sessionId, event.timestamp);
				break;
			case "tool.start":
				this.mutate((data) => {
					data.tools.started += 1;
					recordToolStart(data, event.toolName);
				}, event.timestamp);
				break;
			case "tool.end":
				this.mutate((data) => {
					data.tools.completed += 1;
					if (event.isError) data.tools.failed += 1;
					data.tools.totalDurationMs += Math.max(0, event.durationMs);
					recordToolEnd(data, event.toolName, event.isError, event.durationMs);
				}, event.timestamp);
				break;
			case "usage.update":
				this.mutate((data) => {
					data.usage.inputTokens += Math.max(0, event.input);
					data.usage.outputTokens += Math.max(0, event.output);
					data.usage.cacheReadTokens += Math.max(0, event.cacheRead);
					data.usage.cacheWriteTokens += Math.max(0, event.cacheWrite);
					data.usage.costTotal += Math.max(0, event.costTotal);
				}, event.timestamp);
				break;
			case "compaction.start":
				this.mutate((data) => {
					data.compactions.started += 1;
				}, event.timestamp);
				break;
			case "compaction.end":
				this.mutate((data) => {
					data.compactions[event.success ? "succeeded" : "failed"] += 1;
				}, event.timestamp);
				break;
			case "error":
				this.mutate((data) => {
					data.errors[event.error.origin] += 1;
				}, event.timestamp);
				break;
		}
	}

	private ensureEngagementDay(timestamp: number): void {
		const dayKey = formatDayKey(timestamp, this.profile.reportingTimeZone);
		if (this.data.engagement.currentDay === dayKey) return;
		this.mutate((data) => {
			ensureEngagementDay(data, dayKey);
		}, timestamp);
	}

	private recordSessionTurn(sessionId: string, timestamp: number): void {
		const stats = this.sessionStats.get(sessionId) ?? { turns: 0, messages: 0 };
		stats.turns += 1;
		this.sessionStats.set(sessionId, stats);
		const dailyStats = this.getDailySessionStats(sessionId, timestamp);
		dailyStats.turns += 1;
		this.mutate(
			(data) => {
				data.sessions.turns += 1;
				markActiveDay(data, timestamp, this.profile.reportingTimeZone);
				this.updateLongestConversation(data, stats);
			},
			timestamp,
			(data) => {
				data.sessions.turns += 1;
				markActiveDay(data, timestamp, this.profile.reportingTimeZone);
				this.updateLongestConversation(data, dailyStats);
			},
		);
	}

	private recordSessionMessage(sessionId: string, timestamp: number): void {
		const stats = this.sessionStats.get(sessionId) ?? { turns: 0, messages: 0 };
		stats.messages += 1;
		this.sessionStats.set(sessionId, stats);
		const dailyStats = this.getDailySessionStats(sessionId, timestamp);
		dailyStats.messages += 1;
		this.mutate(
			(data) => {
				data.sessions.messages += 1;
				markActiveDay(data, timestamp, this.profile.reportingTimeZone);
				data.engagement.todayMessages += 1;
				this.updateLongestConversation(data, stats);
			},
			timestamp,
			(data) => {
				data.sessions.messages += 1;
				markActiveDay(data, timestamp, this.profile.reportingTimeZone);
				data.engagement.todayMessages += 1;
				this.updateLongestConversation(data, dailyStats);
			},
		);
	}

	private getDailySessionStats(sessionId: string, timestamp: number): SessionEngagementStats {
		const dayKey = formatDayKey(timestamp, this.profile.reportingTimeZone);
		const key = `${dayKey}\0${sessionId}`;
		const stats = this.dailySessionStats.get(key) ?? { turns: 0, messages: 0 };
		this.dailySessionStats.set(key, stats);
		return stats;
	}

	private updateLongestConversation(data: AppMonitorData, stats: SessionEngagementStats): void {
		data.engagement.longestConversationTurns = Math.max(data.engagement.longestConversationTurns, stats.turns);
		data.engagement.longestConversationMessages = Math.max(
			data.engagement.longestConversationMessages,
			stats.messages,
		);
	}

	private mutate(
		update: (data: AppMonitorData) => void,
		timestamp = Date.now(),
		updateDaily: (data: AppMonitorData) => void = update,
	): void {
		try {
			update(this.data);
			this.data.updatedAt = timestamp;
			this.revision += 1;
		} catch (error) {
			log.warn("in-memory update failed", error);
		}
		if (!this.initialized) return;
		try {
			const bucket = this.ensureDayBucket(timestamp);
			updateDaily(bucket.data);
			bucket.data.updatedAt = timestamp;
			this.touchMonth(timestamp);
		} catch (error) {
			log.warn("daily in-memory update failed", error);
		}
	}

	private ensureDayBucket(timestamp: number): AppMonitorDayBucket {
		const monthKey = getAppMonitorMonthKey(timestamp, this.profile);
		let month = this.months.get(monthKey);
		if (!month) {
			month = createDefaultAppMonitorMonthData(monthKey, this.profile, timestamp);
			this.months.set(monthKey, month);
			this.persistedMonthRevisions.set(monthKey, 0);
		}
		const dayKey = formatDayKey(timestamp, this.profile.reportingTimeZone);
		const existing = month.days[dayKey];
		if (existing) return existing;
		const bucket = getOrCreateAppMonitorDayBucket(month, timestamp);
		this.touchMonth(timestamp);
		return bucket;
	}

	private touchMonth(timestamp: number): void {
		const monthKey = getAppMonitorMonthKey(timestamp, this.profile);
		const month = this.months.get(monthKey);
		if (!month) return;
		month.updatedAt = timestamp;
		month.revision += 1;
	}
}

const appMonitor = new AppMonitorService();

function ensureEngagementDay(data: AppMonitorData, dayKey: string): void {
	if (data.engagement.currentDay === dayKey) return;
	data.engagement.currentDay = dayKey;
	data.engagement.todayForegroundActiveMs = 0;
	data.engagement.todayMessages = 0;
}

function markActiveDay(data: AppMonitorData, timestamp: number, reportingTimeZone: string): void {
	const dayKey = formatDayKey(timestamp, reportingTimeZone);
	ensureEngagementDay(data, dayKey);
	if (data.engagement.lastActiveDay === dayKey) return;
	data.engagement.activeDayStreak =
		data.engagement.lastActiveDay === getPreviousDayKey(timestamp, reportingTimeZone)
			? data.engagement.activeDayStreak + 1
			: 1;
	data.engagement.lastActiveDay = dayKey;
}

function recordToolStart(data: AppMonitorData, rawToolName: string): void {
	const stats = getToolStats(data, rawToolName);
	if (!stats) return;
	stats.started += 1;
}

function recordToolEnd(data: AppMonitorData, rawToolName: string, isError: boolean, durationMs: number): void {
	const stats = getToolStats(data, rawToolName);
	if (!stats) return;
	stats.completed += 1;
	if (isError) stats.failed += 1;
	stats.totalDurationMs += Math.max(0, durationMs);
}

function recordInputAttachmentsAdded(
	data: AppMonitorData,
	event: Extract<AppMonitorEvent, { type: "input.attachments.added" }>,
): void {
	const files = event.files ?? [];
	const images = event.images ?? [];
	if (files.length === 0 && images.length === 0) return;
	data.inputAttachments.events += 1;
	data.inputAttachments.bySource[event.source] = (data.inputAttachments.bySource[event.source] ?? 0) + 1;
	for (const file of files) {
		data.inputAttachments.files.added += 1;
		if (file.isDirectory) data.inputAttachments.files.directories += 1;
		const extension = normalizeMetricKey(file.extension);
		data.inputAttachments.files.byExtension[extension] =
			(data.inputAttachments.files.byExtension[extension] ?? 0) + 1;
		data.inputAttachments.files.totalSizeBytes += normalizeDelta(file.sizeBytes ?? 0);
	}
	for (const image of images) {
		const format = normalizeMetricKey(image.format);
		const sizeBytes = normalizeDelta(image.sizeBytes ?? 0);
		const width = normalizeDelta(image.width ?? 0);
		const height = normalizeDelta(image.height ?? 0);
		const pixels = width > 0 && height > 0 ? width * height : 0;
		data.inputAttachments.images.added += 1;
		data.inputAttachments.images.totalSizeBytes += sizeBytes;
		if (!data.inputAttachments.images.byFormat[format]) {
			data.inputAttachments.images.byFormat[format] = {
				count: 0,
				totalSizeBytes: 0,
			};
		}
		const formatStats = data.inputAttachments.images.byFormat[format];
		formatStats.count += 1;
		formatStats.totalSizeBytes += sizeBytes;
		data.inputAttachments.images.maxWidth = Math.max(data.inputAttachments.images.maxWidth, width);
		data.inputAttachments.images.maxHeight = Math.max(data.inputAttachments.images.maxHeight, height);
		data.inputAttachments.images.maxPixels = Math.max(data.inputAttachments.images.maxPixels, pixels);
		data.inputAttachments.images.minWidth = minPositive(data.inputAttachments.images.minWidth, width);
		data.inputAttachments.images.minHeight = minPositive(data.inputAttachments.images.minHeight, height);
		data.inputAttachments.images.minPixels = minPositive(data.inputAttachments.images.minPixels, pixels);
		updateImageExtrema(data, image, format, sizeBytes, width, height, pixels);
	}
}

function updateImageExtrema(
	data: AppMonitorData,
	image: AppMonitorInputImageAttachment,
	format: string,
	sizeBytes: number,
	width: number,
	height: number,
	pixels: number,
): void {
	const value = { format, sizeBytes, width, height, pixels };
	if (image.sizeBytes !== undefined) {
		if (!data.inputAttachments.images.largest || sizeBytes > data.inputAttachments.images.largest.sizeBytes) {
			data.inputAttachments.images.largest = value;
		}
		if (!data.inputAttachments.images.smallest || sizeBytes < data.inputAttachments.images.smallest.sizeBytes) {
			data.inputAttachments.images.smallest = value;
		}
	}
}

function recordInputActionToggled(
	data: AppMonitorData,
	event: Extract<AppMonitorEvent, { type: "input.action.toggled" }>,
): void {
	const actionId = normalizeInputActionId(event.actionId);
	if (actionId === "") return;
	data.inputActions.events += 1;
	if (event.active) data.inputActions.activated += 1;
	else data.inputActions.deactivated += 1;
	updateInputActionStats(data.inputActions.byKind, event.actionKind, event.active);
	updateInputActionStats(data.inputActions.byAction, actionId, event.active);
}

function updateInputActionStats(
	statsByKey: AppMonitorData["inputActions"]["byAction"],
	rawKey: string,
	active: boolean,
): void {
	const key = normalizeInputActionId(rawKey);
	if (key === "") return;
	if (!statsByKey[key]) {
		statsByKey[key] = {
			toggles: 0,
			activated: 0,
			deactivated: 0,
		};
	}
	const stats = statsByKey[key];
	stats.toggles += 1;
	if (active) stats.activated += 1;
	else stats.deactivated += 1;
}

function recordInputActionUsed(
	data: AppMonitorData,
	event: Extract<AppMonitorEvent, { type: "input.action.used" }>,
): void {
	const actions = event.actions
		.map((action) => ({
			actionId: normalizeInputActionId(action.actionId),
			actionKind: normalizeInputActionId(action.actionKind),
		}))
		.filter((action) => action.actionId !== "" && action.actionKind !== "");
	if (actions.length === 0) return;
	data.inputActions.used.events += 1;
	data.inputActions.used.actions += actions.length;
	for (const action of actions) {
		updateInputActionUsageStats(data.inputActions.used.byKind, action.actionKind);
		updateInputActionUsageStats(data.inputActions.used.byAction, action.actionId);
	}
}

function updateInputActionUsageStats(
	statsByKey: AppMonitorData["inputActions"]["used"]["byAction"],
	rawKey: string,
): void {
	const key = normalizeInputActionId(rawKey);
	if (key === "") return;
	if (!statsByKey[key]) {
		statsByKey[key] = {
			used: 0,
		};
	}
	statsByKey[key].used += 1;
}

function recordInputContextUsed(
	data: AppMonitorData,
	event: Extract<AppMonitorEvent, { type: "input.context.used" }>,
	timestamp: number,
): void {
	const files = event.files ?? [];
	const images = event.images ?? [];
	if (files.length === 0 && images.length === 0 && !event.promptRef) return;
	data.inputAttachments.used.events += 1;
	for (const file of files) {
		data.inputAttachments.used.files.used += 1;
		if (file.isDirectory) data.inputAttachments.used.files.directories += 1;
		const extension = normalizeMetricKey(file.extension);
		data.inputAttachments.used.files.byExtension[extension] =
			(data.inputAttachments.used.files.byExtension[extension] ?? 0) + 1;
		data.inputAttachments.used.files.totalSizeBytes += normalizeDelta(file.sizeBytes ?? 0);
	}
	for (const image of images) {
		recordInputImageUsed(data, image);
	}
	if (event.promptRef) {
		recordInputPromptRefUsed(data, event.promptRef.kind, event.promptRef.name, timestamp);
	}
}

function recordInputImageUsed(data: AppMonitorData, image: AppMonitorInputImageAttachment): void {
	const format = normalizeMetricKey(image.format);
	const sizeBytes = normalizeDelta(image.sizeBytes ?? 0);
	const width = normalizeDelta(image.width ?? 0);
	const height = normalizeDelta(image.height ?? 0);
	const pixels = width > 0 && height > 0 ? width * height : 0;
	data.inputAttachments.used.images.used += 1;
	data.inputAttachments.used.images.totalSizeBytes += sizeBytes;
	if (!data.inputAttachments.used.images.byFormat[format]) {
		data.inputAttachments.used.images.byFormat[format] = {
			count: 0,
			totalSizeBytes: 0,
		};
	}
	const formatStats = data.inputAttachments.used.images.byFormat[format];
	formatStats.count += 1;
	formatStats.totalSizeBytes += sizeBytes;
	data.inputAttachments.used.images.maxWidth = Math.max(data.inputAttachments.used.images.maxWidth, width);
	data.inputAttachments.used.images.maxHeight = Math.max(data.inputAttachments.used.images.maxHeight, height);
	data.inputAttachments.used.images.maxPixels = Math.max(data.inputAttachments.used.images.maxPixels, pixels);
	data.inputAttachments.used.images.minWidth = minPositive(data.inputAttachments.used.images.minWidth, width);
	data.inputAttachments.used.images.minHeight = minPositive(data.inputAttachments.used.images.minHeight, height);
	data.inputAttachments.used.images.minPixels = minPositive(data.inputAttachments.used.images.minPixels, pixels);
	const value = { format, sizeBytes, width, height, pixels };
	if (image.sizeBytes !== undefined) {
		if (
			!data.inputAttachments.used.images.largest ||
			sizeBytes > data.inputAttachments.used.images.largest.sizeBytes
		) {
			data.inputAttachments.used.images.largest = value;
		}
		if (
			!data.inputAttachments.used.images.smallest ||
			sizeBytes < data.inputAttachments.used.images.smallest.sizeBytes
		) {
			data.inputAttachments.used.images.smallest = value;
		}
	}
}

function recordInputPromptRefUsed(data: AppMonitorData, rawKind: string, rawName: string, timestamp: number): void {
	const kind = normalizeMetricKey(rawKind);
	const name = normalizeMetricKey(rawName);
	if (kind === "unknown" || name === "unknown") return;
	const refKey = `${kind}:${name}`;
	data.inputPromptRefs.events += 1;
	if (kind === "skill") data.inputPromptRefs.skills += 1;
	if (kind === "scene") data.inputPromptRefs.scenes += 1;
	data.inputPromptRefs.byKind[kind] = (data.inputPromptRefs.byKind[kind] ?? 0) + 1;
	data.inputPromptRefs.byName[name] = (data.inputPromptRefs.byName[name] ?? 0) + 1;
	data.inputPromptRefs.byRef[refKey] ??= {
		kind,
		name,
		used: 0,
		lastUsedAt: 0,
	};
	const stats = data.inputPromptRefs.byRef[refKey];
	stats.used += 1;
	stats.lastUsedAt = timestamp;
	data.inputPromptRefs.recent = { ...stats };
	if (kind === "skill") data.inputPromptRefs.recentSkill = { ...stats };
	if (kind === "scene") data.inputPromptRefs.recentScene = { ...stats };
	updateMostUsedPromptRef(data, stats);
}

function recordResourceLifecycle(
	data: AppMonitorData,
	event: Extract<AppMonitorEvent, { type: "resource.lifecycle" }>,
	timestamp: number,
): void {
	const kind = normalizeMetricKey(event.resourceKind);
	const id = normalizeResourceId(event.resourceId);
	const operation = normalizeMetricKey(event.operation);
	if ((kind !== "skill" && kind !== "scene" && kind !== "plugin") || id === "" || operation === "unknown") return;
	const source = event.source ? normalizeMetricKey(event.source) : "";
	data.resources.events += 1;
	data.resources.byOperation[operation] = (data.resources.byOperation[operation] ?? 0) + 1;
	if (source !== "" && source !== "unknown") {
		data.resources.bySource[source] = (data.resources.bySource[source] ?? 0) + 1;
	}
	const kindStats = getResourceKindStats(data.resources.byKind, kind);
	updateResourceOperationStats(kindStats, operation, event.permissionCount, event.commandCount);
	const resourceKey = `${kind}:${id}`;
	data.resources.byResource[resourceKey] ??= {
		kind,
		id,
		events: 0,
		installed: 0,
		updated: 0,
		imported: 0,
		uninstalled: 0,
		enabled: 0,
		disabled: 0,
		reloaded: 0,
		permissionGrants: 0,
		permissionRevokes: 0,
		commandGrants: 0,
		commandRevokes: 0,
		permissionsChanged: 0,
		commandsChanged: 0,
		lastOperation: "",
		lastOperationAt: 0,
		system: event.system === true,
	};
	const resourceStats = data.resources.byResource[resourceKey];
	resourceStats.events += 1;
	resourceStats.lastOperation = operation;
	resourceStats.lastOperationAt = timestamp;
	resourceStats.system = event.system === true;
	if (source !== "" && source !== "unknown") resourceStats.source = source;
	updateResourceOperationStats(resourceStats, operation, event.permissionCount, event.commandCount);
	data.resources.recent = { ...resourceStats };
	data.resources.recentByKind[kind] = { ...resourceStats };
	if (isMoreOperatedResource(resourceStats, data.resources.mostOperated)) {
		data.resources.mostOperated = { ...resourceStats };
	}
	if (isMoreOperatedResource(resourceStats, data.resources.mostOperatedByKind[kind])) {
		data.resources.mostOperatedByKind[kind] = { ...resourceStats };
	}
}

function recordSettingsChanged(
	data: AppMonitorData,
	event: Extract<AppMonitorEvent, { type: "settings.changed" }>,
	timestamp: number,
): void {
	const tab = normalizeMetricKey(event.tab);
	const action = normalizeMetricKey(event.action);
	const target = normalizeMetricKey(event.target);
	const value = event.value ? normalizeMetricKey(event.value) : "";
	if (tab === "unknown" || action === "unknown" || target === "unknown") return;
	const entryKey =
		value === "" || value === "unknown" ? `${tab}:${action}:${target}` : `${tab}:${action}:${target}:${value}`;
	data.settings.events += 1;
	data.settings.byAction[action] = (data.settings.byAction[action] ?? 0) + 1;
	data.settings.byTarget[target] = (data.settings.byTarget[target] ?? 0) + 1;
	if (value !== "" && value !== "unknown") {
		data.settings.byValue[value] = (data.settings.byValue[value] ?? 0) + 1;
	}
	const tabStats = getSettingsScopeStats(data.settings.byTab, tab);
	tabStats.events += 1;
	tabStats.byAction[action] = (tabStats.byAction[action] ?? 0) + 1;
	tabStats.byTarget[target] = (tabStats.byTarget[target] ?? 0) + 1;
	if (value !== "" && value !== "unknown") {
		tabStats.byValue[value] = (tabStats.byValue[value] ?? 0) + 1;
	}
	data.settings.byEntry[entryKey] ??= {
		tab,
		action,
		target,
		...(value === "" || value === "unknown" ? {} : { value }),
		used: 0,
		lastUsedAt: 0,
	};
	const stats = data.settings.byEntry[entryKey];
	stats.used += 1;
	stats.lastUsedAt = timestamp;
	data.settings.recent = { ...stats };
	if (isMoreUsedSetting(stats, data.settings.mostUsed)) {
		data.settings.mostUsed = { ...stats };
	}
}

function getSettingsScopeStats(
	statsByKey: AppMonitorData["settings"]["byTab"],
	rawKey: string,
): AppMonitorData["settings"]["byTab"][string] {
	const key = normalizeMetricKey(rawKey);
	statsByKey[key] ??= {
		events: 0,
		byAction: {},
		byTarget: {},
		byValue: {},
	};
	return statsByKey[key];
}

function isMoreUsedSetting(
	stats: AppMonitorData["settings"]["mostUsed"],
	current: AppMonitorData["settings"]["mostUsed"],
): boolean {
	if (!stats) return false;
	if (!current) return true;
	return stats.used > current.used || (stats.used === current.used && stats.lastUsedAt > current.lastUsedAt);
}

function getResourceKindStats(
	statsByKey: AppMonitorData["resources"]["byKind"],
	rawKey: string,
): AppMonitorData["resources"]["byKind"][string] {
	const key = normalizeMetricKey(rawKey);
	statsByKey[key] ??= {
		events: 0,
		installed: 0,
		updated: 0,
		imported: 0,
		uninstalled: 0,
		enabled: 0,
		disabled: 0,
		reloaded: 0,
		permissionGrants: 0,
		permissionRevokes: 0,
		commandGrants: 0,
		commandRevokes: 0,
		permissionsChanged: 0,
		commandsChanged: 0,
	};
	return statsByKey[key];
}

function updateResourceOperationStats(
	stats: AppMonitorData["resources"]["byKind"][string],
	operation: string,
	permissionCount: number | undefined,
	commandCount: number | undefined,
): void {
	stats.events += 1;
	switch (operation) {
		case "installed":
			stats.installed += 1;
			break;
		case "updated":
			stats.updated += 1;
			break;
		case "imported":
			stats.imported += 1;
			break;
		case "uninstalled":
			stats.uninstalled += 1;
			break;
		case "enabled":
			stats.enabled += 1;
			break;
		case "disabled":
			stats.disabled += 1;
			break;
		case "reloaded":
			stats.reloaded += 1;
			break;
		case "permissions-granted":
			stats.permissionGrants += 1;
			stats.permissionsChanged += normalizeDelta(permissionCount ?? 0);
			break;
		case "permissions-revoked":
			stats.permissionRevokes += 1;
			stats.permissionsChanged += normalizeDelta(permissionCount ?? 0);
			break;
		case "commands-granted":
			stats.commandGrants += 1;
			stats.commandsChanged += normalizeDelta(commandCount ?? 0);
			break;
		case "commands-revoked":
			stats.commandRevokes += 1;
			stats.commandsChanged += normalizeDelta(commandCount ?? 0);
			break;
	}
}

function isMoreOperatedResource(
	stats: AppMonitorData["resources"]["mostOperated"],
	current: AppMonitorData["resources"]["mostOperated"],
): boolean {
	if (!stats) return false;
	if (!current) return true;
	return (
		stats.events > current.events ||
		(stats.events === current.events && stats.lastOperationAt > current.lastOperationAt)
	);
}

function updateMostUsedPromptRef(data: AppMonitorData, stats: AppMonitorData["inputPromptRefs"]["mostUsed"]): void {
	if (!stats) return;
	if (isMoreUsedPromptRef(stats, data.inputPromptRefs.mostUsed)) {
		data.inputPromptRefs.mostUsed = { ...stats };
	}
	if (stats.kind === "skill" && isMoreUsedPromptRef(stats, data.inputPromptRefs.mostUsedSkill)) {
		data.inputPromptRefs.mostUsedSkill = { ...stats };
	}
	if (stats.kind === "scene" && isMoreUsedPromptRef(stats, data.inputPromptRefs.mostUsedScene)) {
		data.inputPromptRefs.mostUsedScene = { ...stats };
	}
}

function isMoreUsedPromptRef(
	stats: AppMonitorData["inputPromptRefs"]["mostUsed"],
	current: AppMonitorData["inputPromptRefs"]["mostUsed"],
): boolean {
	if (!stats) return false;
	if (!current) return true;
	return stats.used > current.used || (stats.used === current.used && stats.lastUsedAt > current.lastUsedAt);
}

function getToolStats(
	data: AppMonitorData,
	rawToolName: string,
): AppMonitorData["tools"]["byName"][string] | undefined {
	const toolName = normalizeToolName(rawToolName);
	if (!toolName) return undefined;
	data.tools.byName[toolName] ??= {
		started: 0,
		completed: 0,
		failed: 0,
		totalDurationMs: 0,
	};
	return data.tools.byName[toolName];
}

function normalizeToolName(value: string): string {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") return "";
	return trimmed.slice(0, 128);
}

function normalizeInputActionId(value: string): string {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") return "";
	return trimmed.slice(0, 128);
}

function normalizeResourceId(value: string): string {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") return "";
	return trimmed.slice(0, 128);
}

function normalizeDelta(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeMetricKey(value: string): string {
	const trimmed = value.trim().toLowerCase();
	if (trimmed === "" || trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") {
		return "unknown";
	}
	return trimmed.slice(0, 64);
}

function minPositive(current: number, next: number): number {
	if (next <= 0) return current;
	return current === 0 ? next : Math.min(current, next);
}

function normalizeAmountDelta(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

export function initializeAppMonitor(): Promise<void> {
	return appMonitor.initialize();
}

export function setAppMonitorWindowVisible(visible: boolean): void {
	appMonitor.setWindowVisible(visible);
}

export function recordAppMonitorUserActivity(): void {
	appMonitor.recordUserActivity();
}

export function recordAppMonitorEvent(event: AppMonitorEvent): void {
	appMonitor.recordEvent(event);
}

export function recordBatchProjectCreated(): void {
	appMonitor.recordBatchProjectCreated();
}

export function recordBatchRunStarted(): void {
	appMonitor.recordBatchRunStarted();
}

export function recordAutomationTaskCreated(): void {
	appMonitor.recordAutomationTaskCreated();
}

export function recordAutomationRunStarted(): void {
	appMonitor.recordAutomationRunStarted();
}

export function recordKnowledgeBaseManualScan(): void {
	appMonitor.recordKnowledgeBaseManualScan();
}

export function recordKnowledgeBaseRetryFailed(): void {
	appMonitor.recordKnowledgeBaseRetryFailed();
}

export function recordKnowledgeBaseClearWiki(): void {
	appMonitor.recordKnowledgeBaseClearWiki();
}

export function recordKnowledgeBaseFilesAdded(count: number): void {
	appMonitor.recordKnowledgeBaseFilesAdded(count);
}

export function recordKnowledgeBaseFilesDeleted(count: number): void {
	appMonitor.recordKnowledgeBaseFilesDeleted(count);
}

export function recordKnowledgeBaseProcessingRound(): void {
	appMonitor.recordKnowledgeBaseProcessingRound();
}

export function recordKnowledgeBaseProcessingUsage(usage: KnowledgeBaseProcessingUsage): void {
	appMonitor.recordKnowledgeBaseProcessingUsage(usage);
}

export function recordKnowledgeBaseProcessingResult(filesProcessed: number, filesFailed: number): void {
	appMonitor.recordKnowledgeBaseProcessingResult(filesProcessed, filesFailed);
}

export function recordKnowledgeBaseSnapshot(snapshot: KnowledgeBaseMonitorSnapshot): void {
	appMonitor.recordKnowledgeBaseSnapshot(snapshot);
}

export function getAppMonitorSnapshot(): AppMonitorData {
	return appMonitor.getSnapshot();
}

export function monitorRuntimeSession(runtime: RuntimeHost, sessionId: string, kind: MonitoredSessionKind): void {
	appMonitor.monitorSession(runtime, sessionId, kind);
}

export function stopMonitoringRuntimeSession(sessionId: string): void {
	appMonitor.stopMonitoringSession(sessionId);
}

export function shutdownAppMonitor(): Promise<void> {
	return appMonitor.shutdown();
}
