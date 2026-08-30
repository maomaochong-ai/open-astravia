import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";
import { createVettaActionRegistrar } from "../action-usage";

type DownloadsQueryInput = { operation: "help" } | { operation: "list" };
type DownloadsManageInput = { operation: "cancel"; id: string };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "list" } }, required: ["operation"], additionalProperties: false },
	],
};
const manageSchema: PluginJsonSchema = {
	type: "object",
	properties: { operation: { const: "cancel" }, id: { type: "string", minLength: 1 } },
	required: ["operation", "id"],
	additionalProperties: false,
};

const queryExamples: PluginAppActionExample<DownloadsQueryInput>[] = [
	{ description: "列出下载", input: { operation: "list" } },
];
const manageExamples: PluginAppActionExample<DownloadsManageInput>[] = [
	{ description: "取消下载", input: { operation: "cancel", id: "..." } },
];

export function registerDownloadsActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "downloads");
	register<DownloadsQueryInput>({
		id: "downloads.query",
		publicId: "downloads.query",
		title: "查询下载任务",
		summary: "列出下载中心任务状态。",
		description: '对象参数；operation 为 "help" 或 "list"。',
		keywords: ["下载", "download", "下载中心"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance: "下载中心列表与取消；页面目录 navigation.query help；打开页面 navigation.open target=downloads。",
					actions: [
						{ id: "downloads.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "downloads.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			return { items: await ctx.official.downloads.list() };
		},
	});
	register<DownloadsManageInput>({
		id: "downloads.manage",
		publicId: "downloads.manage",
		title: "管理下载任务",
		summary: "取消下载任务。",
		description: '对象参数；operation 为 "cancel"。id 必须来自 downloads.query list。',
		keywords: ["下载", "取消下载", "cancel"],
		effect: "write",
		approval: {
			defaultPresentation: "downloads.cancel",
			presentations: [
				{ id: "downloads.cancel", title: "取消下载确认", description: "展示待取消的下载任务。" },
			],
			presentationByOperation: { cancel: "downloads.cancel" },
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			const items = await ctx.official.downloads.list();
			if (items.some((item) => item.id === input.id)) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "download task",
				idField: "id",
				id: input.id,
				queryAction: "downloads.query",
				queryExample: { operation: "list" },
				resultIdPath: "items[].id",
				availableIds: items.map((item) => item.id),
				extra: "Use the download task id, not the filename.",
			});
		},
		handler: async ({ input }) => {
			await ctx.official.downloads.cancel(input.id);
			return { operation: input.operation, id: input.id };
		},
	});
}
