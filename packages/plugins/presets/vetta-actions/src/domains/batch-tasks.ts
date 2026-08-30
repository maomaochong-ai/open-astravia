import type {
	PluginAppActionExample,
	PluginContext,
	PluginJsonSchema,
	PluginOfficialBatchProjectCreateData,
	PluginOfficialBatchProjectUpdateData,
} from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";
import { createVettaActionRegistrar } from "../action-usage";

type QueryInput =
	| { operation: "help" }
	| { operation: "list" }
	| { operation: "get"; projectId: string };
type ProjectInput =
	| { operation: "create"; data: PluginOfficialBatchProjectCreateData }
	| { operation: "update"; projectId: string; data: PluginOfficialBatchProjectUpdateData }
	| { operation: "delete"; projectId: string };
type TaskInput =
	| { operation: "run"; projectId: string; taskId: string }
	| { operation: "retry"; projectId: string; taskId: string }
	| { operation: "stop"; projectId: string; taskId: string }
	| { operation: "delete"; projectId: string; taskId: string }
	| { operation: "resume"; projectId: string; taskId: string }
	| { operation: "resume-with-text"; projectId: string; taskId: string; text: string }
	| { operation: "delete-session"; projectId: string; taskId: string };
type ExecutionInput =
	| { operation: "delete-all"; projectId: string }
	| { operation: "start"; projectId: string }
	| { operation: "stop"; projectId: string }
	| { operation: "reset"; projectId: string }
	| { operation: "reset-failed"; projectId: string; taskIds: string[] };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "list" } }, required: ["operation"], additionalProperties: false },
		{
			properties: {
				operation: { const: "get" },
				projectId: { type: "string", minLength: 1 },
			},
			required: ["operation", "projectId"],
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
const createProjectDataSchema = {
	type: "object",
	properties: {
		name: nonBlankStringSchema,
		prompt: { type: "string" },
		modelKey: nonBlankStringSchema,
		folders: { type: "array", items: nonBlankStringSchema, minItems: 1 },
		concurrency: { type: "integer", minimum: 1, maximum: 64 },
		executionMode: executionModeSchema,
		artifactPatterns: { type: "array", items: nonBlankStringSchema },
		notifyEnabled: { type: "boolean" },
		timeoutMinutes: { type: "integer", minimum: 1, maximum: 10_080 },
		skill: skillSchema,
	},
	required: ["name", "prompt", "folders", "concurrency"],
	additionalProperties: false,
} as const;
const updateProjectDataSchema = {
	type: "object",
	properties: {
		name: nonBlankStringSchema,
		prompt: { type: "string" },
		modelKey: nonBlankStringSchema,
		concurrency: { type: "integer", minimum: 1, maximum: 64 },
		executionMode: executionModeSchema,
		artifactPatterns: { type: "array", items: nonBlankStringSchema },
		notifyEnabled: { type: "boolean" },
		timeoutMinutes: { type: "integer", minimum: 1, maximum: 10_080 },
		newFolders: { type: "array", items: nonBlankStringSchema },
		skill: { anyOf: [skillSchema, { type: "null" }] },
	},
	minProperties: 1,
	additionalProperties: false,
} as const;

const projectSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				operation: { const: "create" },
				data: createProjectDataSchema,
			},
			required: ["operation", "data"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "update" },
				projectId: { type: "string", minLength: 1 },
				data: updateProjectDataSchema,
			},
			required: ["operation", "projectId", "data"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "delete" },
				projectId: { type: "string", minLength: 1 },
			},
			required: ["operation", "projectId"],
			additionalProperties: false,
		},
	],
};

const taskSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		...(["run", "retry", "stop", "delete", "resume", "delete-session"] as const).map((operation) => ({
			properties: {
				operation: { const: operation },
				projectId: { type: "string", minLength: 1 },
				taskId: { type: "string", minLength: 1 },
			},
			required: ["operation", "projectId", "taskId"],
			additionalProperties: false,
		})),
		{
			properties: {
				operation: { const: "resume-with-text" },
				projectId: { type: "string", minLength: 1 },
				taskId: { type: "string", minLength: 1 },
				text: { type: "string" },
			},
			required: ["operation", "projectId", "taskId", "text"],
			additionalProperties: false,
		},
	],
};

const executionSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		...(["delete-all", "start", "stop", "reset"] as const).map((operation) => ({
			properties: {
				operation: { const: operation },
				projectId: { type: "string", minLength: 1 },
			},
			required: ["operation", "projectId"],
			additionalProperties: false,
		})),
		{
			properties: {
				operation: { const: "reset-failed" },
				projectId: { type: "string", minLength: 1 },
				taskIds: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
			},
			required: ["operation", "projectId", "taskIds"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<QueryInput>[] = [
	{ description: "列出批量项目", input: { operation: "list" } },
];
const projectExamples: PluginAppActionExample<ProjectInput>[] = [
	{
		description: "创建批量项目",
		input: {
			operation: "create",
			data: {
				name: "文档整理",
				prompt: "整理目录中的文档",
				folders: ["C:\\\\data\\\\a"],
				concurrency: 2,
			},
		},
	},
];
const taskExamples: PluginAppActionExample<TaskInput>[] = [
	{
		description: "执行子任务",
		input: { operation: "run", projectId: "C:\\\\workspace\\\\文档整理", taskId: "batch-task-..." },
	},
];
const executionExamples: PluginAppActionExample<ExecutionInput>[] = [
	{ description: "开始项目", input: { operation: "start", projectId: "C:\\\\workspace\\\\文档整理" } },
];

export function registerBatchTasksActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "batch-tasks");
	register<QueryInput>({
		id: "batch-tasks.query",
		publicId: "batch-tasks.query",
		title: "查询批量任务",
		summary: "查看批量任务操作帮助、项目列表或指定项目及其子任务状态。",
		description: '对象参数；operation 为 "help"、"list" 或 "get"。get 还需要 projectId。',
		keywords: ["批量", "批量任务", "批处理", "batch", "list", "查询", "列表", "projectId"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"更新批量项目时只提交用户要求变更的字段。执行类操作只提交命令并立即返回；请使用 batch-tasks.query 继续查询状态。",
					actions: [
						{ id: "batch-tasks.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "batch-tasks.project", inputSchema: projectSchema, examples: projectExamples },
						{ id: "batch-tasks.task", inputSchema: taskSchema, examples: taskExamples },
						{ id: "batch-tasks.execution", inputSchema: executionSchema, examples: executionExamples },
					],
				};
			}
			if (input.operation === "list") return ctx.official.batchTasks.listProjects();
			return ctx.official.batchTasks.getProject(input.projectId);
		},
	});

	register<ProjectInput>({
		id: "batch-tasks.project",
		publicId: "batch-tasks.project",
		title: "管理批量项目",
		summary: "创建、更新或删除批量项目。",
		description: '对象参数；operation 为 "create"、"update" 或 "delete"。',
		keywords: ["批量", "batch", "项目", "create", "update", "delete", "创建", "更新", "删除"],
		effect: "write",
		approval: {
			defaultPresentation: "batch-tasks.project",
			presentations: [
				{
					id: "batch-tasks.project",
					title: "批量项目操作确认",
					description: "展示批量项目创建、更新或删除操作详情，由用户确认是否执行。",
				},
			],
			presentationByOperation: {
				create: "batch-tasks.project",
				update: "batch-tasks.project",
				delete: "batch-tasks.project",
			},
		},
		inputSchema: projectSchema,
		examples: projectExamples,
		assertReady: async ({ input }) => {
			if (input.operation === "create") return;
			const ids = await ctx.official.batchTasks.listProjectIds();
			if (ids.includes(input.projectId)) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "batch project",
				idField: "projectId",
				id: input.projectId,
				queryAction: "batch-tasks.query",
				queryExample: { operation: "list" },
				resultIdPath: "projects[].id",
				availableIds: ids,
			});
		},
		handler: async ({ input }) => {
			if (input.operation === "create") return ctx.official.batchTasks.createProject(input.data);
			if (input.operation === "update") {
				return ctx.official.batchTasks.updateProject(input.projectId, input.data);
			}
			return ctx.official.batchTasks.deleteProject(input.projectId);
		},
	});

	register<TaskInput>({
		id: "batch-tasks.task",
		publicId: "batch-tasks.task",
		title: "操作批量子任务",
		summary: "执行、重试、停止、删除、继续子任务，或删除子任务会话。",
		description:
			'对象参数；operation 为 "run"、"retry"、"stop"、"delete"、"resume"、"resume-with-text" 或 "delete-session"。',
		keywords: ["批量", "子任务", "batch", "run", "retry", "stop", "resume", "taskId"],
		effect: "write",
		approval: {
			defaultPresentation: "batch-tasks.task",
			presentations: [
				{
					id: "batch-tasks.task",
					title: "批量任务操作确认",
					description: "展示批量任务执行、重试、停止、删除等操作详情，由用户确认是否执行。",
				},
			],
			presentationByOperation: {
				run: "batch-tasks.task",
				retry: "batch-tasks.task",
				stop: "batch-tasks.task",
				delete: "batch-tasks.task",
				resume: "batch-tasks.task",
				"resume-with-text": "batch-tasks.task",
				"delete-session": "batch-tasks.task",
			},
		},
		inputSchema: taskSchema,
		examples: taskExamples,
		assertReady: async ({ input }) => {
			const project = (await ctx.official.batchTasks.getProject(input.projectId)) as {
				tasks?: Array<{ id: string }>;
			};
			const taskIds = (project.tasks ?? []).map((task) => task.id);
			if (taskIds.includes(input.taskId)) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "batch task",
				idField: "taskId",
				id: input.taskId,
				queryAction: "batch-tasks.query",
				queryExample: { operation: "get", projectId: input.projectId },
				resultIdPath: "project.tasks[].id",
				availableIds: taskIds,
				extra: `projectId=${JSON.stringify(input.projectId)} exists, but this taskId is not in that project.`,
			});
		},
		handler: async ({ input }) => {
			switch (input.operation) {
				case "run":
					return ctx.official.batchTasks.runTask(input.projectId, input.taskId);
				case "retry":
					return ctx.official.batchTasks.retryTask(input.projectId, input.taskId);
				case "stop":
					return ctx.official.batchTasks.stopTask(input.projectId, input.taskId);
				case "delete":
					return ctx.official.batchTasks.deleteTask(input.projectId, input.taskId);
				case "resume":
					return ctx.official.batchTasks.resumeTask(input.projectId, input.taskId);
				case "resume-with-text":
					return ctx.official.batchTasks.resumeTaskWithText(input.projectId, input.taskId, input.text);
				case "delete-session":
					return ctx.official.batchTasks.deleteTaskSession(input.projectId, input.taskId);
			}
		},
	});

	register<ExecutionInput>({
		id: "batch-tasks.execution",
		publicId: "batch-tasks.execution",
		title: "控制批量项目执行",
		summary: "批量开始、停止、重置、重置失败任务或删除全部非运行任务。",
		description: '对象参数；operation 为 "delete-all"、"start"、"stop"、"reset" 或 "reset-failed"。',
		keywords: ["批量", "batch", "start", "stop", "reset", "开始", "停止", "重置", "执行控制"],
		effect: "execute",
		approval: {
			defaultPresentation: "batch-tasks.execution",
			presentations: [
				{
					id: "batch-tasks.execution",
					title: "批量执行控制确认",
					description: "展示批量执行开始、停止、重置等操作详情，由用户确认是否执行。",
				},
			],
			presentationByOperation: {
				"delete-all": "batch-tasks.execution",
				start: "batch-tasks.execution",
				stop: "batch-tasks.execution",
				reset: "batch-tasks.execution",
				"reset-failed": "batch-tasks.execution",
			},
		},
		inputSchema: executionSchema,
		examples: executionExamples,
		assertReady: async ({ input }) => {
			const ids = await ctx.official.batchTasks.listProjectIds();
			if (!ids.includes(input.projectId)) {
				throwEntityNotFound({
					operation: input.operation,
					entity: "batch project",
					idField: "projectId",
					id: input.projectId,
					queryAction: "batch-tasks.query",
					queryExample: { operation: "list" },
					resultIdPath: "projects[].id",
					availableIds: ids,
				});
			}
			if (input.operation !== "reset-failed") return;
			const project = (await ctx.official.batchTasks.getProject(input.projectId)) as {
				tasks?: Array<{ id: string }>;
			};
			const known = new Set((project.tasks ?? []).map((task) => task.id));
			const missing = input.taskIds.filter((taskId) => !known.has(taskId));
			if (missing.length === 0) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "batch task",
				idField: "taskIds",
				id: missing.join(","),
				queryAction: "batch-tasks.query",
				queryExample: { operation: "get", projectId: input.projectId },
				resultIdPath: "project.tasks[].id",
				availableIds: [...known],
				extra: `Missing taskIds: ${JSON.stringify(missing)}.`,
			});
		},
		handler: async ({ input }) => {
			switch (input.operation) {
				case "delete-all":
					return ctx.official.batchTasks.batchDelete(input.projectId);
				case "start":
					return ctx.official.batchTasks.batchStart(input.projectId);
				case "stop":
					return ctx.official.batchTasks.batchStop(input.projectId);
				case "reset":
					return ctx.official.batchTasks.batchReset(input.projectId);
				case "reset-failed":
					return ctx.official.batchTasks.batchResetFailed(input.projectId, input.taskIds);
			}
		},
	});
}
