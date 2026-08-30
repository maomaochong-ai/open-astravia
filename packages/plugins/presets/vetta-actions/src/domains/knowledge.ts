import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";
import { createVettaActionRegistrar } from "../action-usage";

type KnowledgeQueryInput =
	| { operation: "help" }
	| { operation: "list" }
	| { operation: "statuses" }
	| { operation: "is-processing" }
	| { operation: "get-processing" };
type KnowledgeManageInput =
	| { operation: "create"; name: string }
	| { operation: "rename"; name: string; newName: string }
	| { operation: "delete"; name: string }
	| { operation: "add-files"; kbId: string; paths: string[]; move?: boolean }
	| { operation: "delete-entry"; kbId: string; relPath: string }
	| { operation: "scan-now" }
	| { operation: "retry-failed" }
	| {
			operation: "set-processing";
			data: {
				enabled?: boolean;
				pollIntervalMinutes?: 3 | 5 | 10 | 30;
				processingModelKey?: string | null;
				processingModelReasoningLevel?: string | null;
				agentConcurrency?: number;
				ocrConcurrency?: number;
			};
	  };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "list" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "statuses" } }, required: ["operation"], additionalProperties: false },
		{
			properties: { operation: { const: "is-processing" } },
			required: ["operation"],
			additionalProperties: false,
		},
		{
			properties: { operation: { const: "get-processing" } },
			required: ["operation"],
			additionalProperties: false,
		},
	],
};

const manageSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				operation: { const: "create" },
				name: { type: "string", minLength: 1 },
			},
			required: ["operation", "name"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "rename" },
				name: { type: "string", minLength: 1 },
				newName: { type: "string", minLength: 1 },
			},
			required: ["operation", "name", "newName"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "delete" },
				name: { type: "string", minLength: 1 },
			},
			required: ["operation", "name"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "add-files" },
				kbId: { type: "string", minLength: 1 },
				paths: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
				move: { type: "boolean" },
			},
			required: ["operation", "kbId", "paths"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "delete-entry" },
				kbId: { type: "string", minLength: 1 },
				relPath: { type: "string", minLength: 1 },
			},
			required: ["operation", "kbId", "relPath"],
			additionalProperties: false,
		},
		{ properties: { operation: { const: "scan-now" } }, required: ["operation"], additionalProperties: false },
		{
			properties: { operation: { const: "retry-failed" } },
			required: ["operation"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "set-processing" },
				data: {
					type: "object",
					minProperties: 1,
					properties: {
						enabled: { type: "boolean" },
						pollIntervalMinutes: { enum: [3, 5, 10, 30] },
						processingModelKey: { type: ["string", "null"], minLength: 1 },
						processingModelReasoningLevel: { type: ["string", "null"], minLength: 1 },
						agentConcurrency: { type: "integer", minimum: 1, maximum: 16 },
						ocrConcurrency: { type: "integer", minimum: 1, maximum: 8 },
					},
					additionalProperties: false,
				},
			},
			required: ["operation", "data"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<KnowledgeQueryInput>[] = [
	{ description: "列出知识库", input: { operation: "list" } },
	{ description: "查看加工状态", input: { operation: "is-processing" } },
	{ description: "读取加工策略配置", input: { operation: "get-processing" } },
];
const manageExamples: PluginAppActionExample<KnowledgeManageInput>[] = [
	{ description: "创建知识库", input: { operation: "create", name: "产品文档" } },
	{ description: "立即加工", input: { operation: "scan-now" } },
	{
		description: "导入文件",
		input: { operation: "add-files", kbId: "default_kb", paths: ["C:\\\\docs\\\\a.pdf"] },
	},
	{ description: "开启知识库加工", input: { operation: "set-processing", data: { enabled: true } } },
];

export function registerKnowledgeActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "knowledge");
	register<KnowledgeQueryInput>({
		id: "knowledge.query",
		publicId: "knowledge.query",
		title: "查询知识库",
		summary: "列出知识库、文件加工态、是否在加工，以及加工策略配置。",
		description:
			'对象参数；operation 为 "help"、"list"、"statuses"、"is-processing" 或 "get-processing"（加工策略配置）。',
		keywords: ["知识库", "knowledge", "wiki", "加工", "索引", "raws", "整理模型", "processing"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"知识库实体与加工策略都在 knowledge.*。set-processing 对应设置 → 知识库；list/add-files 管理库与文件。",
					actions: [
						{ id: "knowledge.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "knowledge.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			if (input.operation === "list") return ctx.official.knowledge.list();
			if (input.operation === "statuses") return ctx.official.knowledge.fileStatuses();
			if (input.operation === "get-processing") {
				return { knowledgeBase: await ctx.official.knowledge.getProcessing() };
			}
			return { processing: await ctx.official.knowledge.isProcessing() };
		},
	});
	register<KnowledgeManageInput>({
		id: "knowledge.manage",
		publicId: "knowledge.manage",
		title: "管理知识库",
		summary: "创建/重命名/删除知识库，导入文件，触发加工，以及修改加工策略。",
		description:
			'对象参数；operation 为 "create"、"rename"、"delete"、"add-files"、"delete-entry"、"scan-now"、"retry-failed" 或 "set-processing"。',
		keywords: ["知识库", "导入", "加工", "scan", "knowledge", "整理", "processing", "模型"],
		effect: "write",
		timeoutMs: 120_000,
		approval: {
			defaultPresentation: "knowledge.create",
			presentations: [
				{ id: "knowledge.create", title: "创建知识库确认", description: "展示并可编辑知识库名称。" },
				{ id: "knowledge.rename", title: "重命名知识库确认", description: "展示并可编辑新名称。" },
				{ id: "knowledge.delete", title: "删除知识库确认", description: "展示待删除知识库。" },
				{ id: "knowledge.add-files", title: "添加知识库文件确认", description: "展示待添加文件列表。" },
				{ id: "knowledge.delete-entry", title: "删除知识库条目确认", description: "展示待删除条目。" },
				{ id: "knowledge.scan-now", title: "立即整理知识库确认", description: "确认触发整理。" },
				{ id: "knowledge.retry-failed", title: "重试失败知识库任务确认", description: "确认重试失败任务。" },
				{ id: "knowledge.set-processing", title: "修改知识库加工设置确认", description: "确认加工策略变更。" },
			],
			presentationByOperation: {
				create: "knowledge.create",
				rename: "knowledge.rename",
				delete: "knowledge.delete",
				"add-files": "knowledge.add-files",
				"delete-entry": "knowledge.delete-entry",
				"scan-now": "knowledge.scan-now",
				"retry-failed": "knowledge.retry-failed",
				"set-processing": "knowledge.set-processing",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (
				input.operation === "create" ||
				input.operation === "scan-now" ||
				input.operation === "retry-failed" ||
				input.operation === "set-processing"
			) {
				return;
			}
			const bases = await ctx.official.knowledge.list();
			const names = bases.map((item) => item.name);
			const ids = bases.map((item) => item.id);
			if (input.operation === "rename" || input.operation === "delete") {
				if (names.includes(input.name)) return;
				throwEntityNotFound({
					operation: input.operation,
					entity: "knowledge base",
					idField: "name",
					id: input.name,
					queryAction: "knowledge.query",
					queryExample: { operation: "list" },
					resultIdPath: "list result array items[].name",
					availableIds: names,
				});
			}
			if (input.operation === "add-files" || input.operation === "delete-entry") {
				if (ids.includes(input.kbId)) return;
				throwEntityNotFound({
					operation: input.operation,
					entity: "knowledge base",
					idField: "kbId",
					id: input.kbId,
					queryAction: "knowledge.query",
					queryExample: { operation: "list" },
					resultIdPath: "list result array items[].id",
					availableIds: ids,
					extra: "kbId is the knowledge base directory id from list, usually same as name.",
				});
			}
		},
		handler: async ({ input }) => {
			switch (input.operation) {
				case "create":
					await ctx.official.knowledge.create(input.name);
					return { operation: input.operation, name: input.name };
				case "rename":
					await ctx.official.knowledge.rename(input.name, input.newName);
					return { operation: input.operation, name: input.name, newName: input.newName };
				case "delete":
					await ctx.official.knowledge.delete(input.name);
					return { operation: input.operation, name: input.name };
				case "add-files":
					await ctx.official.knowledge.addFiles(input.kbId, input.paths, input.move);
					return {
						operation: input.operation,
						kbId: input.kbId,
						count: input.paths.length,
						move: input.move ?? false,
					};
				case "delete-entry":
					await ctx.official.knowledge.deleteEntry(input.kbId, input.relPath);
					return { operation: input.operation, kbId: input.kbId, relPath: input.relPath };
				case "scan-now":
					return { operation: input.operation, ...(await ctx.official.knowledge.scanNow()) };
				case "retry-failed":
					return { operation: input.operation, ...(await ctx.official.knowledge.retryFailed()) };
				case "set-processing":
					return {
						operation: input.operation,
						knowledgeBase: await ctx.official.knowledge.setProcessing(input.data),
					};
			}
		},
	});
}
