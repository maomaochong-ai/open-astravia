import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema, rejectCapabilitySchemaExcess } from "../schema.js";

export const SCHEDULER_EXECUTION_MODES = {
	INHERIT: "inherit",
	SANDBOX: "sandbox",
	FULL_ACCESS: "full-access",
} as const;

export const SCHEDULER_SKILL_TYPES = {
	SKILL: "skill",
	SCENE: "scene",
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
} as const;

export const SCHEDULER_COMMAND_STATUSES = {
	ACCEPTED: "accepted",
	NOOP: "noop",
} as const;

const schedulerEmptyInputType = Type.Object({}, { additionalProperties: false });

const schedulerExecutionModeType = Type.Union([
	Type.Literal(SCHEDULER_EXECUTION_MODES.INHERIT),
	Type.Literal(SCHEDULER_EXECUTION_MODES.SANDBOX),
	Type.Literal(SCHEDULER_EXECUTION_MODES.FULL_ACCESS),
]);

const schedulerRecordExecutionModeType = Type.Union([
	Type.Literal(SCHEDULER_EXECUTION_MODES.SANDBOX),
	Type.Literal(SCHEDULER_EXECUTION_MODES.FULL_ACCESS),
]);

const schedulerSkillTypeType = Type.Union([
	Type.Literal(SCHEDULER_SKILL_TYPES.SKILL),
	Type.Literal(SCHEDULER_SKILL_TYPES.SCENE),
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
]);

const schedulerCommandStatusType = Type.Union([
	Type.Literal(SCHEDULER_COMMAND_STATUSES.ACCEPTED),
	Type.Literal(SCHEDULER_COMMAND_STATUSES.NOOP),
]);

const schedulerNonBlankInputStringType = Type.String({ pattern: "\\S" });

const schedulerSkillInputType = Type.Object(
	{
		name: schedulerNonBlankInputStringType,
		alias: Type.Optional(schedulerNonBlankInputStringType),
		type: schedulerSkillTypeType,
	},
	{ additionalProperties: false },
);

const schedulerSkillOutputType = Type.Object(
	{
		name: Type.String(),
		alias: Type.Optional(Type.String({ pattern: "\\S" })),
		type: schedulerSkillTypeType,
	},
	{ additionalProperties: false },
);

const schedulerTaskType = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		prompt: Type.String(),
		cron: Type.String(),
		isOnce: Type.Boolean(),
		enabled: Type.Boolean(),
		cwd: Type.String(),
		modelKey: Type.Optional(Type.String()),
		executionMode: Type.Optional(schedulerExecutionModeType),
		skill: Type.Optional(schedulerSkillOutputType),
		createdAt: Type.Number(),
		updatedAt: Type.Number(),
		lastRunAt: Type.Union([Type.Number(), Type.Null()]),
		lastRunStatus: Type.Union([schedulerLastRunStatusType, Type.Null()]),
	},
	{ additionalProperties: false },
);

const schedulerTaskDataFields = {
	name: Type.Optional(schedulerNonBlankInputStringType),
	prompt: Type.Optional(schedulerNonBlankInputStringType),
	cron: Type.Optional(schedulerNonBlankInputStringType),
	isOnce: Type.Optional(Type.Boolean()),
	enabled: Type.Optional(Type.Boolean()),
	cwd: Type.Optional(schedulerNonBlankInputStringType),
	modelKey: Type.Optional(schedulerNonBlankInputStringType),
	executionMode: Type.Optional(schedulerExecutionModeType),
	skill: Type.Optional(schedulerSkillInputType),
};

const schedulerTaskCreateDataType = rejectCapabilitySchemaExcess(
	Type.Object(
		{
			name: schedulerNonBlankInputStringType,
			prompt: schedulerNonBlankInputStringType,
			cron: schedulerNonBlankInputStringType,
			isOnce: Type.Boolean(),
			enabled: Type.Boolean(),
			cwd: schedulerNonBlankInputStringType,
			modelKey: Type.Optional(schedulerNonBlankInputStringType),
			executionMode: Type.Optional(schedulerExecutionModeType),
			skill: Type.Optional(schedulerSkillInputType),
		},
		{ additionalProperties: false },
	),
);

const schedulerTaskUpdateDataType = rejectCapabilitySchemaExcess(
	Type.Object(schedulerTaskDataFields, { additionalProperties: false, minProperties: 1 }),
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
		sessionId: Type.String(),
		sessionPath: Type.Optional(Type.String()),
		cwd: Type.Optional(Type.String()),
		startedAt: Type.Number(),
		completedAt: Type.Union([Type.Number(), Type.Null()]),
		status: schedulerRecordStatusType,
		prompt: Type.String(),
		responsePreview: Type.String(),
		error: Type.Optional(Type.String()),
		durationMs: Type.Optional(Type.Number()),
		executionMode: Type.Optional(schedulerRecordExecutionModeType),
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

export type SchedulerExecutionMode = (typeof SCHEDULER_EXECUTION_MODES)[keyof typeof SCHEDULER_EXECUTION_MODES];
export type SchedulerSkillType = (typeof SCHEDULER_SKILL_TYPES)[keyof typeof SCHEDULER_SKILL_TYPES];
export type SchedulerLastRunStatus = (typeof SCHEDULER_LAST_RUN_STATUSES)[keyof typeof SCHEDULER_LAST_RUN_STATUSES];
export type SchedulerRecordStatus = (typeof SCHEDULER_RECORD_STATUSES)[keyof typeof SCHEDULER_RECORD_STATUSES];
export type SchedulerCommandStatus = (typeof SCHEDULER_COMMAND_STATUSES)[keyof typeof SCHEDULER_COMMAND_STATUSES];
export type SchedulerSkillRef = Readonly<Static<typeof schedulerSkillOutputType>>;
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
		version: 1,
		input: schedulerEmptyInputSchema,
		output: schedulerTasksOutputSchema,
	}),
	GET_TASK: defineCapability<SchedulerTaskIdInput, SchedulerTask>({
		id: "cap.domain.vetta.scheduler.task.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: schedulerTaskIdInputSchema,
		output: schedulerTaskOutputSchema,
	}),
	LIST_HISTORY: defineCapability<SchedulerTaskIdInput, SchedulerExecutionRecord[]>({
		id: "cap.domain.vetta.scheduler.task.history.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: schedulerTaskIdInputSchema,
		output: schedulerExecutionRecordsOutputSchema,
	}),
	CREATE_TASK: defineCapability<SchedulerTaskCreateInput, SchedulerTask>({
		id: "cap.domain.vetta.scheduler.task.create",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: schedulerTaskCreateInputSchema,
		output: schedulerTaskOutputSchema,
	}),
	UPDATE_TASK: defineCapability<SchedulerTaskUpdateInput, SchedulerTask>({
		id: "cap.domain.vetta.scheduler.task.update",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
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
		version: 1,
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
