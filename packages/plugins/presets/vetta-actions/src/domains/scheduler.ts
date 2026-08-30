import type {
	PluginAppActionExample,
	PluginContext,
	PluginJsonSchema,
	PluginOfficialSchedulerTaskCreateData,
	PluginOfficialSchedulerTaskUpdateData,
} from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";
import { createVettaActionRegistrar } from "../action-usage";

type QueryInput =
	| { operation: "help" }
	| { operation: "list" }
	| { operation: "get"; taskId: string }
	| { operation: "history"; taskId: string };
type TaskInput =
	| { operation: "create"; data: PluginOfficialSchedulerTaskCreateData }
	| { operation: "update"; taskId: string; data: PluginOfficialSchedulerTaskUpdateData }
	| { operation: "delete"; taskId: string }
	| { operation: "enable"; taskId: string }
	| { operation: "disable"; taskId: string };
type ExecutionInput = { operation: "run-now"; taskId: string } | { operation: "abort"; taskId: string };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "list" } }, required: ["operation"], additionalProperties: false },
		{
			properties: {
				operation: { const: "get" },
				taskId: { type: "string", minLength: 1 },
			},
			required: ["operation", "taskId"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "history" },
				taskId: { type: "string", minLength: 1 },
			},
			required: ["operation", "taskId"],
			additionalProperties: false,
		},
	],
};

const nonBlankStringSchema = { type: "string", minLength: 1, pattern: "\\S" } as const;
const executionModeSchema = { enum: ["inherit", "sandbox", "full-access"] } as const;
const skillSchema = {
	type: "object",
	properties: {
		name: nonBlankStringSchema,
		alias: nonBlankStringSchema,
		type: { enum: ["skill", "scene"] },
	},
	required: ["name", "type"],
	additionalProperties: false,
} as const;
const createTaskDataSchema = {
	type: "object",
	properties: {
		name: nonBlankStringSchema,
		prompt: nonBlankStringSchema,
		cron: nonBlankStringSchema,
		isOnce: { type: "boolean" },
		enabled: { type: "boolean" },
		cwd: nonBlankStringSchema,
		modelKey: nonBlankStringSchema,
		executionMode: executionModeSchema,
		skill: skillSchema,
	},
	required: ["name", "prompt", "cron", "isOnce", "cwd"],
	additionalProperties: false,
} as const;
const updateTaskDataSchema = {
	type: "object",
	properties: {
		name: nonBlankStringSchema,
		prompt: nonBlankStringSchema,
		cron: nonBlankStringSchema,
		isOnce: { type: "boolean" },
		enabled: { type: "boolean" },
		cwd: nonBlankStringSchema,
		modelKey: { anyOf: [nonBlankStringSchema, { type: "null" }] },
		executionMode: executionModeSchema,
		skill: { anyOf: [skillSchema, { type: "null" }] },
	},
	minProperties: 1,
	additionalProperties: false,
} as const;

const taskSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				operation: { const: "create" },
				data: createTaskDataSchema,
			},
			required: ["operation", "data"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "update" },
				taskId: { type: "string", minLength: 1 },
				data: updateTaskDataSchema,
			},
			required: ["operation", "taskId", "data"],
			additionalProperties: false,
		},
		...(["delete", "enable", "disable"] as const).map((operation) => ({
			properties: {
				operation: { const: operation },
				taskId: { type: "string", minLength: 1 },
			},
			required: ["operation", "taskId"],
			additionalProperties: false,
		})),
	],
};

const executionSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				operation: { const: "run-now" },
				taskId: { type: "string", minLength: 1 },
			},
			required: ["operation", "taskId"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "abort" },
				taskId: { type: "string", minLength: 1 },
			},
			required: ["operation", "taskId"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<QueryInput>[] = [
	{ description: "列出定时任务", input: { operation: "list" } },
];
const taskExamples: PluginAppActionExample<TaskInput>[] = [
	{
		description: "创建每日任务",
		input: {
			operation: "create",
			data: {
				name: "每日总结",
				prompt: "总结今天的进展",
				cron: "0 18 * * *",
				isOnce: false,
				cwd: "C:\\\\Users\\\\me\\\\.vetta\\\\conversation",
			},
		},
	},
];
const executionExamples: PluginAppActionExample<ExecutionInput>[] = [
	{ description: "立即执行任务", input: { operation: "run-now", taskId: "..." } },
];

export function registerSchedulerActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "scheduler");
	register<QueryInput>({
		id: "scheduler.query",
		publicId: "scheduler.query",
		title: "查询定时任务",
		summary: "查看定时任务操作帮助、任务列表、任务详情或执行历史。",
		description: '对象参数；operation 为 "help"、"list"、"get" 或 "history"。',
		keywords: ["定时", "定时任务", "计划任务", "自动化", "cron", "schedule", "list", "history"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"更新任务时只提交用户要求变更的字段。系统会自动选择与 operation 对应的确认界面。",
					actions: [
						{ id: "scheduler.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "scheduler.task", inputSchema: taskSchema, examples: taskExamples },
						{ id: "scheduler.execution", inputSchema: executionSchema, examples: executionExamples },
					],
				};
			}
			if (input.operation === "list") return ctx.official.scheduler.listTasks();
			if (input.operation === "get") return ctx.official.scheduler.getTask(input.taskId);
			return ctx.official.scheduler.getHistory(input.taskId);
		},
	});

	register<TaskInput>({
		id: "scheduler.task",
		publicId: "scheduler.task",
		title: "管理定时任务",
		summary: "创建、更新、删除、启用或停用定时任务。",
		description: '对象参数；operation 为 "create"、"update"、"delete"、"enable" 或 "disable"。',
		keywords: ["定时", "cron", "create", "update", "delete", "enable", "disable", "prompt", "cwd"],
		effect: "write",
		approval: {
			defaultPresentation: "scheduler.create",
			presentations: [
				{ id: "scheduler.create", title: "创建定时任务确认", description: "展示待创建的定时任务详情。" },
				{ id: "scheduler.update", title: "更新定时任务确认", description: "展示定时任务的变更内容。" },
				{ id: "scheduler.delete", title: "删除定时任务确认", description: "展示待删除的定时任务信息。" },
				{ id: "scheduler.toggle", title: "启用/停用定时任务确认", description: "展示定时任务的启用状态变更。" },
			],
			presentationByOperation: {
				create: "scheduler.create",
				update: "scheduler.update",
				delete: "scheduler.delete",
				enable: "scheduler.toggle",
				disable: "scheduler.toggle",
			},
		},
		inputSchema: taskSchema,
		examples: taskExamples,
		assertReady: async ({ input }) => {
			if (input.operation === "create") return;
			const ids = await ctx.official.scheduler.listTaskIds();
			if (ids.includes(input.taskId)) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "scheduled task",
				idField: "taskId",
				id: input.taskId,
				queryAction: "scheduler.query",
				queryExample: { operation: "list" },
				resultIdPath: "tasks[].id",
				availableIds: ids,
			});
		},
		handler: async ({ input }) => {
			switch (input.operation) {
				case "create":
					return ctx.official.scheduler.createTask({ ...input.data, enabled: input.data.enabled ?? true });
				case "update":
					return ctx.official.scheduler.updateTask(input.taskId, input.data);
				case "delete":
					return ctx.official.scheduler.deleteTask(input.taskId);
				case "enable":
					return ctx.official.scheduler.setEnabled(input.taskId, true);
				case "disable":
					return ctx.official.scheduler.setEnabled(input.taskId, false);
			}
		},
	});

	register<ExecutionInput>({
		id: "scheduler.execution",
		publicId: "scheduler.execution",
		title: "控制定时任务执行",
		summary: "立即执行或中止定时任务。",
		description: '对象参数；operation 为 "run-now" 或 "abort"。',
		keywords: ["定时", "run-now", "abort", "立即执行", "中止"],
		effect: "execute",
		approval: {
			defaultPresentation: "scheduler.run-now",
			presentations: [
				{ id: "scheduler.run-now", title: "立即执行定时任务确认", description: "展示待执行的定时任务信息。" },
				{ id: "scheduler.abort", title: "中止定时任务确认", description: "展示运行中的定时任务信息。" },
			],
			presentationByOperation: {
				"run-now": "scheduler.run-now",
				abort: "scheduler.abort",
			},
		},
		inputSchema: executionSchema,
		examples: executionExamples,
		assertReady: async ({ input }) => {
			const ids = await ctx.official.scheduler.listTaskIds();
			if (ids.includes(input.taskId)) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "scheduled task",
				idField: "taskId",
				id: input.taskId,
				queryAction: "scheduler.query",
				queryExample: { operation: "list" },
				resultIdPath: "tasks[].id",
				availableIds: ids,
			});
		},
		handler: async ({ input }) =>
			input.operation === "run-now"
				? ctx.official.scheduler.runNow(input.taskId)
				: ctx.official.scheduler.abort(input.taskId),
	});
}
