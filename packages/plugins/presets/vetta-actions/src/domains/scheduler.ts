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
const minuteSchema = { type: "integer", minimum: 0, maximum: 59 } as const;
const hourSchema = { type: "integer", minimum: 0, maximum: 23 } as const;
const scheduleSchema = {
	description:
		"重复规则，按本机时区。once.at 为毫秒时间戳；weekly.weekdays 取 0-6（0 为周日）；monthly.days 取 1-31 或 \"last\"；interval 从 startAt（毫秒时间戳，通常取当前时间）起每 everyMinutes 分钟一次；custom.cron 为 5 段 cron。",
	oneOf: [
		{
			type: "object",
			properties: { kind: { const: "once" }, at: { type: "number" } },
			required: ["kind", "at"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: { kind: { const: "hourly" }, minute: minuteSchema },
			required: ["kind", "minute"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: { kind: { const: "daily" }, hour: hourSchema, minute: minuteSchema },
			required: ["kind", "hour", "minute"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: {
				kind: { const: "weekly" },
				weekdays: { type: "array", minItems: 1, items: { type: "integer", minimum: 0, maximum: 6 } },
				hour: hourSchema,
				minute: minuteSchema,
			},
			required: ["kind", "weekdays", "hour", "minute"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: {
				kind: { const: "monthly" },
				days: {
					type: "array",
					minItems: 1,
					items: { anyOf: [{ type: "integer", minimum: 1, maximum: 31 }, { const: "last" }] },
				},
				hour: hourSchema,
				minute: minuteSchema,
			},
			required: ["kind", "days", "hour", "minute"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: {
				kind: { const: "interval" },
				everyMinutes: { type: "integer", minimum: 1, maximum: 10080 },
				startAt: { type: "number" },
			},
			required: ["kind", "everyMinutes", "startAt"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: { kind: { const: "custom" }, cron: nonBlankStringSchema },
			required: ["kind", "cron"],
			additionalProperties: false,
		},
	],
} as const;
const runTargetSchema = {
	description:
		"运行会话策略。new-session：每次触发在 projectCwd 所属项目下新建会话；same-session：所有触发投进同一会话，sessionPath 为 null 时首次执行新建并一直复用。projectCwd 取 projects.query list 返回的项目路径；省略即落在默认「对话」里。",
	oneOf: [
		{
			type: "object",
			properties: { mode: { const: "new-session" }, projectCwd: nonBlankStringSchema },
			required: ["mode"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: {
				mode: { const: "same-session" },
				projectCwd: nonBlankStringSchema,
				sessionPath: { anyOf: [nonBlankStringSchema, { type: "null" }] },
			},
			required: ["mode", "sessionPath"],
			additionalProperties: false,
		},
	],
} as const;
const modelSchema = {
	description: "省略即跟随默认模型。key 形如 provider/modelId；reasoning 为思考强度。",
	type: "object",
	properties: { key: nonBlankStringSchema, reasoning: nonBlankStringSchema },
	required: ["key"],
	additionalProperties: false,
} as const;
const notificationSchema = {
	description: "webhook 通知。template 支持 {{name}} {{status}} {{startedAt}} {{duration}} {{reply}} {{error}}。",
	type: "object",
	properties: {
		webhookIds: { type: "array", minItems: 1, items: nonBlankStringSchema },
		when: { enum: ["always", "success", "failure"] },
		template: nonBlankStringSchema,
	},
	required: ["webhookIds", "when", "template"],
	additionalProperties: false,
} as const;
const createTaskDataSchema = {
	type: "object",
	properties: {
		name: nonBlankStringSchema,
		prompt: nonBlankStringSchema,
		schedule: scheduleSchema,
		runTarget: runTargetSchema,
		model: modelSchema,
		notification: notificationSchema,
		enabled: { type: "boolean" },
	},
	required: ["name", "prompt", "schedule", "runTarget"],
	additionalProperties: false,
} as const;
const updateTaskDataSchema = {
	type: "object",
	properties: {
		name: nonBlankStringSchema,
		prompt: nonBlankStringSchema,
		schedule: scheduleSchema,
		runTarget: runTargetSchema,
		model: { anyOf: [modelSchema, { type: "null" }] },
		notification: { anyOf: [notificationSchema, { type: "null" }] },
		enabled: { type: "boolean" },
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
		description: "每天 18:00 在「对话」里各开一个新会话写日报（省略 projectCwd 即对话）",
		input: {
			operation: "create",
			data: {
				name: "每日总结",
				prompt: "总结今天的进展",
				schedule: { kind: "daily", hour: 18, minute: 0 },
				runTarget: { mode: "new-session" },
			},
		},
	},
	{
		description: "工作日 9:30 在某个项目里跑晨报，用指定模型与思考强度",
		input: {
			operation: "create",
			data: {
				name: "晨间简报",
				prompt: "查看 git 状态并列出今天该关注的三件事",
				schedule: { kind: "weekly", weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 30 },
				runTarget: { mode: "new-session", projectCwd: "/Users/me/code/app" },
				model: { key: "anthropic/claude-opus-5", reasoning: "high" },
			},
		},
	},
	{
		description: "每隔 30 分钟在同一个新会话里接着检查构建（首次执行时建会话，之后复用）",
		input: {
			operation: "create",
			data: {
				name: "盯构建",
				prompt: "检查 CI 最新一次构建，失败就说明原因",
				schedule: { kind: "interval", everyMinutes: 30, startAt: 1790064000000 },
				runTarget: { mode: "same-session", projectCwd: "/Users/me/code/app", sessionPath: null },
			},
		},
	},
	{
		description: "每月最后一天 17:00 复盘，并在失败时发 webhook 通知",
		input: {
			operation: "create",
			data: {
				name: "月度复盘",
				prompt: "汇总本月提交与遗留问题",
				schedule: { kind: "monthly", days: ["last"], hour: 17, minute: 0 },
				runTarget: { mode: "new-session" },
				notification: { webhookIds: ["<webhook.query list 的 id>"], when: "failure", template: "{{name}} {{status}}\n\n{{error}}" },
			},
		},
	},
	{
		description: "明天 8:00 只执行一次",
		input: {
			operation: "create",
			data: {
				name: "提醒查看发布",
				prompt: "检查昨晚的发布是否成功",
				schedule: { kind: "once", at: 1790121600000 },
				runTarget: { mode: "new-session" },
			},
		},
	},
	{
		description: "只改重复时间，不动其他字段",
		input: { operation: "update", taskId: "...", data: { schedule: { kind: "daily", hour: 8, minute: 0 } } },
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
					guidance: [
						"自动化 = 标题 name + 任务正文 prompt + 重复 schedule + 运行会话策略 runTarget，可选 model 与 notification。",
						"runTarget：new-session 每次触发新开会话；same-session 一直在同一个会话里接着跑（sessionPath 为 null 表示首次执行时新建）。项目用 projects.query list 返回的路径；省略 projectCwd 即落在「对话」里。要绑已有会话，先 projects.query list-sessions 取会话路径（「对话」的 cwd 可从 list-runtime-projects 找到）。",
						"schedule 按本机时区：once.at 与 interval.startAt 是毫秒时间戳（interval 一般取当前时间）；weekly.weekdays 0 为周日；monthly.days 可用 \"last\"；custom.cron 是 5 段 cron，能用前几种就别用 custom。",
						"model 省略即每次跟随默认模型；需要指定时用 models.query list 里的 provider/modelId。notification.webhookIds 取 webhook.query list 的 id，template 可用 {{name}} {{status}} {{startedAt}} {{duration}} {{reply}} {{error}}。",
						"自动化运行时无人值守：固定完全访问、不会向用户提问，prompt 要写成不需要追问就能完成的指令。技能写成正文开头的 @skill:名字。",
						"更新任务时只提交用户要求变更的字段；model / notification 传 null 表示清除。系统会自动选择与 operation 对应的确认界面。",
					].join("\n"),
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
		keywords: [
			"定时",
			"自动化",
			"cron",
			"间隔",
			"每天",
			"每周",
			"每月",
			"webhook",
			"create",
			"update",
			"delete",
			"enable",
			"disable",
			"prompt",
			"project",
			"session",
		],
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
