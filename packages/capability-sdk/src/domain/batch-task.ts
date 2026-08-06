import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema, skipCapabilitySchemaClean } from "../schema.js";

export const BATCH_TASK_STATUSES = {
	PENDING: "pending",
	RUNNING: "running",
	COMPLETED: "completed",
	FAILED: "failed",
	PAUSED: "paused",
} as const;

export const BATCH_EXECUTION_MODES = {
	INHERIT: "inherit",
	SANDBOX: "sandbox",
	FULL_ACCESS: "full-access",
} as const;

export const BATCH_SKILL_TYPES = {
	SKILL: "skill",
	SCENE: "scene",
} as const;

export const BATCH_COMMAND_STATUSES = {
	ACCEPTED: "accepted",
	NOOP: "noop",
} as const;

const batchTaskEmptyInputType = Type.Object({}, { additionalProperties: false });

const batchTaskStatusType = Type.Union([
	Type.Literal(BATCH_TASK_STATUSES.PENDING),
	Type.Literal(BATCH_TASK_STATUSES.RUNNING),
	Type.Literal(BATCH_TASK_STATUSES.COMPLETED),
	Type.Literal(BATCH_TASK_STATUSES.FAILED),
	Type.Literal(BATCH_TASK_STATUSES.PAUSED),
]);

const batchExecutionModeType = Type.Union([
	Type.Literal(BATCH_EXECUTION_MODES.INHERIT),
	Type.Literal(BATCH_EXECUTION_MODES.SANDBOX),
	Type.Literal(BATCH_EXECUTION_MODES.FULL_ACCESS),
]);

const batchTaskExecutionModeType = Type.Union([
	Type.Literal(BATCH_EXECUTION_MODES.SANDBOX),
	Type.Literal(BATCH_EXECUTION_MODES.FULL_ACCESS),
]);

const batchSkillTypeType = Type.Union([Type.Literal(BATCH_SKILL_TYPES.SKILL), Type.Literal(BATCH_SKILL_TYPES.SCENE)]);

const batchCommandStatusType = Type.Union([
	Type.Literal(BATCH_COMMAND_STATUSES.ACCEPTED),
	Type.Literal(BATCH_COMMAND_STATUSES.NOOP),
]);

const nonBlankInputStringType = Type.String({ pattern: "\\S" });

const batchSkillOutputType = skipCapabilitySchemaClean(
	Type.Object(
		{
			name: Type.String(),
			alias: Type.Optional(Type.String()),
			type: batchSkillTypeType,
		},
		{ additionalProperties: false },
	),
);

const batchSkillInputType = skipCapabilitySchemaClean(
	Type.Object(
		{
			name: nonBlankInputStringType,
			alias: Type.Optional(nonBlankInputStringType),
			type: batchSkillTypeType,
		},
		{ additionalProperties: false },
	),
);

const batchTaskType = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		cwd: Type.String(),
		sourcePath: Type.String(),
		status: batchTaskStatusType,
		sessionId: Type.Optional(Type.String()),
		sessionPath: Type.Optional(Type.String()),
		executionMode: Type.Optional(batchTaskExecutionModeType),
		error: Type.Optional(Type.String()),
		createdAt: Type.Number({ minimum: 0 }),
		updatedAt: Type.Number({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

const batchProjectType = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		prompt: Type.String(),
		modelKey: Type.Optional(Type.String()),
		executionMode: Type.Optional(batchExecutionModeType),
		concurrency: Type.Integer({ minimum: 1 }),
		artifactPatterns: Type.Optional(Type.Array(Type.String())),
		notifyEnabled: Type.Optional(Type.Boolean()),
		timeoutMinutes: Type.Optional(Type.Number()),
		skill: Type.Optional(batchSkillOutputType),
		tasks: Type.Array(batchTaskType),
		createdAt: Type.Number({ minimum: 0 }),
		updatedAt: Type.Number({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

const batchProjectCreateDataType = skipCapabilitySchemaClean(
	Type.Object(
		{
			name: nonBlankInputStringType,
			prompt: Type.String(),
			modelKey: Type.Optional(nonBlankInputStringType),
			folders: Type.Array(nonBlankInputStringType, { minItems: 1 }),
			concurrency: Type.Integer({ minimum: 1, maximum: 64 }),
			executionMode: Type.Optional(batchExecutionModeType),
			artifactPatterns: Type.Optional(Type.Array(nonBlankInputStringType)),
			notifyEnabled: Type.Optional(Type.Boolean()),
			timeoutMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_080 })),
			skill: Type.Optional(batchSkillInputType),
		},
		{ additionalProperties: false },
	),
);

const batchProjectUpdateDataType = skipCapabilitySchemaClean(
	Type.Object(
		{
			name: Type.Optional(nonBlankInputStringType),
			prompt: Type.Optional(Type.String()),
			modelKey: Type.Optional(nonBlankInputStringType),
			concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
			executionMode: Type.Optional(batchExecutionModeType),
			artifactPatterns: Type.Optional(Type.Array(nonBlankInputStringType)),
			notifyEnabled: Type.Optional(Type.Boolean()),
			timeoutMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_080 })),
			newFolders: Type.Optional(Type.Array(nonBlankInputStringType)),
			skill: Type.Optional(Type.Union([batchSkillInputType, Type.Null()])),
		},
		{ additionalProperties: false, minProperties: 1 },
	),
);

const batchProjectIdInputType = Type.Object(
	{
		projectId: nonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const batchTaskIdInputType = Type.Object(
	{
		projectId: nonBlankInputStringType,
		taskId: nonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const batchTaskIdsInputType = Type.Object(
	{
		projectId: nonBlankInputStringType,
		taskIds: Type.Array(nonBlankInputStringType),
	},
	{ additionalProperties: false },
);

const batchTaskResumeInputType = Type.Object(
	{
		projectId: nonBlankInputStringType,
		taskId: nonBlankInputStringType,
		text: Type.String(),
	},
	{ additionalProperties: false },
);

const batchProjectCreateInputType = Type.Object(
	{
		data: batchProjectCreateDataType,
	},
	{ additionalProperties: false },
);

const batchProjectUpdateInputType = Type.Object(
	{
		projectId: nonBlankInputStringType,
		data: batchProjectUpdateDataType,
	},
	{ additionalProperties: false },
);

const batchTaskCommandResultType = Type.Object(
	{
		status: batchCommandStatusType,
		projectId: Type.String(),
		affectedTaskIds: Type.Array(Type.String()),
		queuedTaskIds: Type.Array(Type.String()),
	},
	{ additionalProperties: false },
);

export type BatchTaskStatus = Static<typeof batchTaskStatusType>;
export type BatchExecutionMode = Static<typeof batchExecutionModeType>;
export type BatchSkillType = Static<typeof batchSkillTypeType>;
export type BatchCommandStatus = Static<typeof batchCommandStatusType>;
export type BatchSkillRef = Readonly<Static<typeof batchSkillOutputType>>;
export type BatchTask = Readonly<Static<typeof batchTaskType>>;
export type BatchProject = Readonly<Static<typeof batchProjectType>>;
export type BatchProjectCreateData = Readonly<Static<typeof batchProjectCreateDataType>>;
export type BatchProjectUpdateData = Readonly<Static<typeof batchProjectUpdateDataType>>;
export type BatchProjectIdInput = Readonly<Static<typeof batchProjectIdInputType>>;
export type BatchTaskIdInput = Readonly<Static<typeof batchTaskIdInputType>>;
export type BatchTaskIdsInput = Readonly<Static<typeof batchTaskIdsInputType>>;
export type BatchTaskResumeInput = Readonly<Static<typeof batchTaskResumeInputType>>;
export type BatchProjectCreateInput = Readonly<Static<typeof batchProjectCreateInputType>>;
export type BatchProjectUpdateInput = Readonly<Static<typeof batchProjectUpdateInputType>>;
export type BatchTaskCommandResult = Readonly<Static<typeof batchTaskCommandResultType>>;

const batchTaskEmptyInputSchema = defineCapabilityInputSchema(batchTaskEmptyInputType);
const batchProjectsOutputSchema = defineCapabilityOutputSchema(Type.Array(batchProjectType), { clean: true });
const batchProjectIdInputSchema = defineCapabilityInputSchema(batchProjectIdInputType, { clean: true });
const batchProjectOutputSchema = defineCapabilityOutputSchema(batchProjectType, { clean: true });
const batchProjectCreateInputSchema = defineCapabilityInputSchema(batchProjectCreateInputType, { clean: true });
const batchProjectUpdateInputSchema = defineCapabilityInputSchema(batchProjectUpdateInputType, { clean: true });
const batchTaskCommandOutputSchema = defineCapabilityOutputSchema(batchTaskCommandResultType, { clean: true });
const batchTaskIdInputSchema = defineCapabilityInputSchema(batchTaskIdInputType, { clean: true });
const batchTaskResumeInputSchema = defineCapabilityInputSchema(batchTaskResumeInputType, { clean: true });
const batchTaskIdsInputSchema = defineCapabilityInputSchema(batchTaskIdsInputType, { clean: true });

export const DOMAIN_BATCH_TASK_CAPABILITIES = {
	LIST_PROJECTS: defineCapability<Record<string, never>, BatchProject[]>({
		id: "cap.domain.vetta.batch-task.project.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskEmptyInputSchema,
		output: batchProjectsOutputSchema,
	}),
	GET_PROJECT: defineCapability<BatchProjectIdInput, BatchProject>({
		id: "cap.domain.vetta.batch-task.project.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchProjectIdInputSchema,
		output: batchProjectOutputSchema,
	}),
	CREATE_PROJECT: defineCapability<BatchProjectCreateInput, BatchProject>({
		id: "cap.domain.vetta.batch-task.project.create",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchProjectCreateInputSchema,
		output: batchProjectOutputSchema,
	}),
	UPDATE_PROJECT: defineCapability<BatchProjectUpdateInput, BatchProject>({
		id: "cap.domain.vetta.batch-task.project.update",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchProjectUpdateInputSchema,
		output: batchProjectOutputSchema,
	}),
	DELETE_PROJECT: defineCapability<BatchProjectIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.project.delete",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchProjectIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	RUN_TASK: defineCapability<BatchTaskIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.task.run",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	RETRY_TASK: defineCapability<BatchTaskIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.task.retry",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	STOP_TASK: defineCapability<BatchTaskIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.task.stop",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	DELETE_TASK: defineCapability<BatchTaskIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.task.delete",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	RESUME_TASK: defineCapability<BatchTaskIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.task.resume",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	RESUME_TASK_WITH_TEXT: defineCapability<BatchTaskResumeInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.task.resume-with-text",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskResumeInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	DELETE_TASK_SESSION: defineCapability<BatchTaskIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.task.session.delete",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	DELETE_ALL_TASKS: defineCapability<BatchProjectIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.project.task.delete-all",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchProjectIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	START_PROJECT: defineCapability<BatchProjectIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.project.start",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchProjectIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	STOP_PROJECT: defineCapability<BatchProjectIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.project.stop",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchProjectIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	RESET_PROJECT: defineCapability<BatchProjectIdInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.project.reset",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchProjectIdInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
	RESET_FAILED_TASKS: defineCapability<BatchTaskIdsInput, BatchTaskCommandResult>({
		id: "cap.domain.vetta.batch-task.project.failed-task.reset",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: batchTaskIdsInputSchema,
		output: batchTaskCommandOutputSchema,
	}),
} as const;

export const DOMAIN_BATCH_TASK_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(DOMAIN_BATCH_TASK_CAPABILITIES),
);
