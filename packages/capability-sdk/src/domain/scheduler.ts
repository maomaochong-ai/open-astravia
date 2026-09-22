import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema, rejectCapabilitySchemaExcess } from "../schema.js";

export const SCHEDULER_RUN_TARGET_MODES = {
	NEW_SESSION: "new-session",
	SAME_SESSION: "same-session",
} as const;

export const SCHEDULER_NOTIFY_WHEN = {
	ALWAYS: "always",
	SUCCESS: "success",
	FAILURE: "failure",
} as const;

export const SCHEDULER_SUSPEND_REASONS = {
	SESSION_DELETED: "session-deleted",
	PROJECT_REMOVED: "project-removed",
} as const;

export const SCHEDULER_LAST_RUN_STATUSES = {
	SUCCESS: "success",
	FAILED: "failed",
} as const;

export const SCHEDULER_RECORD_STATUSES = {
	RUNNING: "running",
	SUCCESS: "success",
	FAILED: "failed",
	ABORTED: "aborted",
	SKIPPED: "skipped",
	MISSED: "missed",
} as const;

export const SCHEDULER_NOT_RUN_REASONS = {
	PREVIOUS_RUNNING: "previous-running",
	APP_NOT_RUNNING: "app-not-running",
	SYSTEM_SLEEP: "system-sleep",
} as const;

export const SCHEDULER_COMMAND_STATUSES = {
	ACCEPTED: "accepted",
	NOOP: "noop",
} as const;

const schedulerEmptyInputType = Type.Object({}, { additionalProperties: false });

const schedulerRunTargetModeType = Type.Union([
	Type.Literal(SCHEDULER_RUN_TARGET_MODES.NEW_SESSION),
	Type.Literal(SCHEDULER_RUN_TARGET_MODES.SAME_SESSION),
]);

const schedulerNotifyWhenType = Type.Union([
	Type.Literal(SCHEDULER_NOTIFY_WHEN.ALWAYS),
	Type.Literal(SCHEDULER_NOTIFY_WHEN.SUCCESS),
	Type.Literal(SCHEDULER_NOTIFY_WHEN.FAILURE),
]);

const schedulerSuspendReasonType = Type.Union([
	Type.Literal(SCHEDULER_SUSPEND_REASONS.SESSION_DELETED),
	Type.Literal(SCHEDULER_SUSPEND_REASONS.PROJECT_REMOVED),
]);

const schedulerLastRunStatusType = Type.Union([
	Type.Literal(SCHEDULER_LAST_RUN_STATUSES.SUCCESS),
	Type.Literal(SCHEDULER_LAST_RUN_STATUSES.FAILED),
]);

const schedulerRecordStatusType = Type.Union([
	Type.Literal(SCHEDULER_RECORD_STATUSES.RUNNING),
	Type.Literal(SCHEDULER_RECORD_STATUSES.SUCCESS),
	Type.Literal(SCHEDULER_RECORD_STATUSES.FAILED),
	Type.Literal(SCHEDULER_RECORD_STATUSES.ABORTED),
	Type.Literal(SCHEDULER_RECORD_STATUSES.SKIPPED),
	Type.Literal(SCHEDULER_RECORD_STATUSES.MISSED),
]);

const schedulerNotRunReasonType = Type.Union([
	Type.Literal(SCHEDULER_NOT_RUN_REASONS.PREVIOUS_RUNNING),
	Type.Literal(SCHEDULER_NOT_RUN_REASONS.APP_NOT_RUNNING),
	Type.Literal(SCHEDULER_NOT_RUN_REASONS.SYSTEM_SLEEP),
]);

const schedulerCommandStatusType = Type.Union([
	Type.Literal(SCHEDULER_COMMAND_STATUSES.ACCEPTED),
	Type.Literal(SCHEDULER_COMMAND_STATUSES.NOOP),
]);

const schedulerNonBlankInputStringType = Type.String({ pattern: "\\S" });
const minuteType = Type.Integer({ minimum: 0, maximum: 59 });
const hourType = Type.Integer({ minimum: 0, maximum: 23 });

/** 「重复」：精确到分钟，按本机时区；星期 0 = 周日。interval 从 startAt 起每 everyMinutes 分钟一次；custom 为 5 段 cron。 */
const schedulerScheduleType = Type.Union([
	Type.Object({ kind: Type.Literal("once"), at: Type.Number() }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("hourly"), minute: minuteType }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("daily"), hour: hourType, minute: minuteType }, { additionalProperties: false }),
	Type.Object(
		{
			kind: Type.Literal("weekly"),
			weekdays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1 }),
			hour: hourType,
			minute: minuteType,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("monthly"),
			days: Type.Array(Type.Union([Type.Integer({ minimum: 1, maximum: 31 }), Type.Literal("last")]), {
				minItems: 1,
			}),
			hour: hourType,
			minute: minuteType,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("interval"),
			everyMinutes: Type.Integer({ minimum: 1, maximum: 10080 }),
			startAt: Type.Number(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{ kind: Type.Literal("custom"), cron: schedulerNonBlankInputStringType },
		{ additionalProperties: false },
	),
]);

/**
 * 运行会话策略：projectCwd 为会话所属的项目（默认对话即对话 cwd）；
 * same-session 的 sessionPath 为 null 表示首次执行时新建一个会话并一直复用。
 */
const schedulerRunTargetType = Type.Union([
	Type.Object(
		{ mode: Type.Literal(SCHEDULER_RUN_TARGET_MODES.NEW_SESSION), projectCwd: schedulerNonBlankInputStringType },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			mode: Type.Literal(SCHEDULER_RUN_TARGET_MODES.SAME_SESSION),
			projectCwd: schedulerNonBlankInputStringType,
			sessionPath: Type.Union([schedulerNonBlankInputStringType, Type.Null()]),
		},
		{ additionalProperties: false },
	),
]);

/** 输入侧：projectCwd 可省略，省略即落在默认「对话」里（表单里项目选「无」）。 */
const schedulerRunTargetInputType = Type.Union([
	Type.Object(
		{
			mode: Type.Literal(SCHEDULER_RUN_TARGET_MODES.NEW_SESSION),
			projectCwd: Type.Optional(schedulerNonBlankInputStringType),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			mode: Type.Literal(SCHEDULER_RUN_TARGET_MODES.SAME_SESSION),
			projectCwd: Type.Optional(schedulerNonBlankInputStringType),
			sessionPath: Type.Union([schedulerNonBlankInputStringType, Type.Null()]),
		},
		{ additionalProperties: false },
	),
]);

/** 省略即「跟随默认模型」，每次触发时解析。 */
const schedulerModelType = Type.Object(
	{ key: schedulerNonBlankInputStringType, reasoning: Type.Optional(schedulerNonBlankInputStringType) },
	{ additionalProperties: false },
);

/** template 支持 {{name}} {{status}} {{startedAt}} {{duration}} {{reply}} {{error}}。 */
const schedulerNotificationType = Type.Object(
	{
		webhookIds: Type.Array(schedulerNonBlankInputStringType, { minItems: 1 }),
		when: schedulerNotifyWhenType,
		template: schedulerNonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const schedulerTaskType = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		prompt: Type.String(),
		schedule: schedulerScheduleType,
		runTarget: schedulerRunTargetType,
		model: Type.Optional(schedulerModelType),
		notification: Type.Optional(schedulerNotificationType),
		enabled: Type.Boolean(),
		suspendedReason: Type.Optional(schedulerSuspendReasonType),
		createdAt: Type.Number(),
		updatedAt: Type.Number(),
		lastRunAt: Type.Union([Type.Number(), Type.Null()]),
		lastRunStatus: Type.Union([schedulerLastRunStatusType, Type.Null()]),
	},
	{ additionalProperties: false },
);

const schedulerTaskCreateDataType = rejectCapabilitySchemaExcess(
	Type.Object(
		{
			name: schedulerNonBlankInputStringType,
			prompt: schedulerNonBlankInputStringType,
			schedule: schedulerScheduleType,
			runTarget: schedulerRunTargetInputType,
			model: Type.Optional(schedulerModelType),
			notification: Type.Optional(schedulerNotificationType),
			enabled: Type.Boolean(),
		},
		{ additionalProperties: false },
	),
);

/** model / notification 传 null 清除。 */
const schedulerTaskUpdateDataType = rejectCapabilitySchemaExcess(
	Type.Object(
		{
			name: Type.Optional(schedulerNonBlankInputStringType),
			prompt: Type.Optional(schedulerNonBlankInputStringType),
			schedule: Type.Optional(schedulerScheduleType),
			runTarget: Type.Optional(schedulerRunTargetInputType),
			model: Type.Optional(Type.Union([schedulerModelType, Type.Null()])),
			notification: Type.Optional(Type.Union([schedulerNotificationType, Type.Null()])),
			enabled: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false, minProperties: 1 },
	),
);

const schedulerTaskIdInputType = Type.Object(
	{
		taskId: schedulerNonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const schedulerTaskCreateInputType = Type.Object(
	{
		data: schedulerTaskCreateDataType,
	},
	{ additionalProperties: false },
);

const schedulerTaskUpdateInputType = Type.Object(
	{
		taskId: schedulerNonBlankInputStringType,
		data: schedulerTaskUpdateDataType,
	},
	{ additionalProperties: false },
);

const schedulerTaskSetEnabledInputType = Type.Object(
	{
		taskId: schedulerNonBlankInputStringType,
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const schedulerExecutionRecordType = Type.Object(
	{
		id: Type.String(),
		taskId: Type.String(),
		sessionId: Type.Optional(Type.String()),
		sessionPath: Type.Optional(Type.String()),
		cwd: Type.Optional(Type.String()),
		mode: Type.Optional(schedulerRunTargetModeType),
		startedAt: Type.Number(),
		completedAt: Type.Union([Type.Number(), Type.Null()]),
		status: schedulerRecordStatusType,
		prompt: Type.String(),
		responsePreview: Type.String(),
		error: Type.Optional(Type.String()),
		durationMs: Type.Optional(Type.Number()),
		reason: Type.Optional(schedulerNotRunReasonType),
		missedCount: Type.Optional(Type.Number()),
		missedUntil: Type.Optional(Type.Number()),
		notifyError: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const schedulerCommandResultType = Type.Object(
	{
		status: schedulerCommandStatusType,
		taskId: Type.String(),
	},
	{ additionalProperties: false },
);

export type SchedulerRunTargetMode = (typeof SCHEDULER_RUN_TARGET_MODES)[keyof typeof SCHEDULER_RUN_TARGET_MODES];
export type SchedulerNotifyWhen = (typeof SCHEDULER_NOTIFY_WHEN)[keyof typeof SCHEDULER_NOTIFY_WHEN];
export type SchedulerSuspendReason = (typeof SCHEDULER_SUSPEND_REASONS)[keyof typeof SCHEDULER_SUSPEND_REASONS];
export type SchedulerNotRunReason = (typeof SCHEDULER_NOT_RUN_REASONS)[keyof typeof SCHEDULER_NOT_RUN_REASONS];
export type SchedulerLastRunStatus = (typeof SCHEDULER_LAST_RUN_STATUSES)[keyof typeof SCHEDULER_LAST_RUN_STATUSES];
export type SchedulerRecordStatus = (typeof SCHEDULER_RECORD_STATUSES)[keyof typeof SCHEDULER_RECORD_STATUSES];
export type SchedulerCommandStatus = (typeof SCHEDULER_COMMAND_STATUSES)[keyof typeof SCHEDULER_COMMAND_STATUSES];
export type SchedulerSchedule = Readonly<Static<typeof schedulerScheduleType>>;
export type SchedulerRunTarget = Readonly<Static<typeof schedulerRunTargetType>>;
export type SchedulerRunTargetInput = Readonly<Static<typeof schedulerRunTargetInputType>>;
export type SchedulerModel = Readonly<Static<typeof schedulerModelType>>;
export type SchedulerNotification = Readonly<Static<typeof schedulerNotificationType>>;
export type SchedulerTask = Readonly<Static<typeof schedulerTaskType>>;
export type SchedulerTaskCreateData = Readonly<Static<typeof schedulerTaskCreateDataType>>;
export type SchedulerTaskUpdateData = Readonly<Static<typeof schedulerTaskUpdateDataType>>;
export type SchedulerTaskIdInput = Readonly<Static<typeof schedulerTaskIdInputType>>;
export type SchedulerTaskCreateInput = Readonly<Static<typeof schedulerTaskCreateInputType>>;
export type SchedulerTaskUpdateInput = Readonly<Static<typeof schedulerTaskUpdateInputType>>;
export type SchedulerTaskSetEnabledInput = Readonly<Static<typeof schedulerTaskSetEnabledInputType>>;
export type SchedulerExecutionRecord = Readonly<Static<typeof schedulerExecutionRecordType>>;
export type SchedulerCommandResult = Readonly<Static<typeof schedulerCommandResultType>>;

const schedulerEmptyInputSchema = defineCapabilityInputSchema(schedulerEmptyInputType);
const schedulerTasksOutputSchema = defineCapabilityOutputSchema(Type.Array(schedulerTaskType), { clean: true });
const schedulerTaskIdInputSchema = defineCapabilityInputSchema(schedulerTaskIdInputType, { clean: true });
const schedulerTaskOutputSchema = defineCapabilityOutputSchema(schedulerTaskType, { clean: true });
const schedulerExecutionRecordsOutputSchema = defineCapabilityOutputSchema(Type.Array(schedulerExecutionRecordType), {
	clean: true,
});
const schedulerTaskCreateInputSchema = defineCapabilityInputSchema(schedulerTaskCreateInputType, { clean: true });
const schedulerTaskUpdateInputSchema = defineCapabilityInputSchema(schedulerTaskUpdateInputType, {
	clean: true,
	preserveUndefinedProperties: true,
});
const schedulerTaskSetEnabledInputSchema = defineCapabilityInputSchema(schedulerTaskSetEnabledInputType, {
	clean: true,
});
const schedulerCommandOutputSchema = defineCapabilityOutputSchema(schedulerCommandResultType, { clean: true });

export const DOMAIN_SCHEDULER_CAPABILITIES = {
	LIST_TASKS: defineCapability<Record<string, never>, SchedulerTask[]>({
		id: "cap.domain.vetta.scheduler.task.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: schedulerEmptyInputSchema,
		output: schedulerTasksOutputSchema,
	}),
	GET_TASK: defineCapability<SchedulerTaskIdInput, SchedulerTask>({
		id: "cap.domain.vetta.scheduler.task.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: schedulerTaskIdInputSchema,
		output: schedulerTaskOutputSchema,
	}),
	LIST_HISTORY: defineCapability<SchedulerTaskIdInput, SchedulerExecutionRecord[]>({
		id: "cap.domain.vetta.scheduler.task.history.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: schedulerTaskIdInputSchema,
		output: schedulerExecutionRecordsOutputSchema,
	}),
	CREATE_TASK: defineCapability<SchedulerTaskCreateInput, SchedulerTask>({
		id: "cap.domain.vetta.scheduler.task.create",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: schedulerTaskCreateInputSchema,
		output: schedulerTaskOutputSchema,
	}),
	UPDATE_TASK: defineCapability<SchedulerTaskUpdateInput, SchedulerTask>({
		id: "cap.domain.vetta.scheduler.task.update",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: schedulerTaskUpdateInputSchema,
		output: schedulerTaskOutputSchema,
	}),
	DELETE_TASK: defineCapability<SchedulerTaskIdInput, SchedulerCommandResult>({
		id: "cap.domain.vetta.scheduler.task.delete",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: schedulerTaskIdInputSchema,
		output: schedulerCommandOutputSchema,
	}),
	SET_ENABLED: defineCapability<SchedulerTaskSetEnabledInput, SchedulerTask>({
		id: "cap.domain.vetta.scheduler.task.set-enabled",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 2,
		input: schedulerTaskSetEnabledInputSchema,
		output: schedulerTaskOutputSchema,
	}),
	RUN_TASK: defineCapability<SchedulerTaskIdInput, SchedulerCommandResult>({
		id: "cap.domain.vetta.scheduler.task.run",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: schedulerTaskIdInputSchema,
		output: schedulerCommandOutputSchema,
	}),
	ABORT_TASK: defineCapability<SchedulerTaskIdInput, SchedulerCommandResult>({
		id: "cap.domain.vetta.scheduler.task.abort",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: schedulerTaskIdInputSchema,
		output: schedulerCommandOutputSchema,
	}),
} as const;

export const DOMAIN_SCHEDULER_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(DOMAIN_SCHEDULER_CAPABILITIES),
);
