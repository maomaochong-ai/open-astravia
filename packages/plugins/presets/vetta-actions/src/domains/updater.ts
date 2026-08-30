import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { createVettaActionRegistrar } from "../action-usage";

type UpdaterQueryInput =
	| { operation: "help" }
	| { operation: "state" }
	| { operation: "version" };
type UpdaterManageInput = {
	operation: "check" | "download" | "install" | "dismiss" | "cancel";
};

const querySchema: PluginJsonSchema = {
	type: "object",
	properties: { operation: { enum: ["help", "state", "version"] } },
	required: ["operation"],
	additionalProperties: false,
};
const manageSchema: PluginJsonSchema = {
	type: "object",
	properties: { operation: { enum: ["check", "download", "install", "dismiss", "cancel"] } },
	required: ["operation"],
	additionalProperties: false,
};

const queryExamples: PluginAppActionExample<UpdaterQueryInput>[] = [
	{ description: "查看更新状态", input: { operation: "state" } },
	{ description: "当前版本", input: { operation: "version" } },
];
const manageExamples: PluginAppActionExample<UpdaterManageInput>[] = [
	{ description: "检查更新", input: { operation: "check" } },
	{ description: "安装并重启", input: { operation: "install" } },
];

export function registerUpdaterActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "updater");
	register<UpdaterQueryInput>({
		id: "updater.query",
		publicId: "updater.query",
		title: "查询应用更新",
		summary: "读取更新器状态与当前版本。",
		description: '对象参数；operation 为 "help"、"state" 或 "version"。',
		keywords: ["更新", "update", "版本", "version", "升级"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance: "install 会重启应用；请先 check/download 到 ready 再 install。",
					actions: [
						{ id: "updater.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "updater.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			if (input.operation === "version") {
				return { version: await ctx.official.updater.getCurrentVersion() };
			}
			return ctx.official.updater.getState();
		},
	});
	register<UpdaterManageInput>({
		id: "updater.manage",
		publicId: "updater.manage",
		title: "管理应用更新",
		summary: "检查、下载、安装更新或取消/稍后。",
		description:
			'对象参数；operation 为 "check"、"download"、"install"、"dismiss" 或 "cancel"。install 会重启应用。',
		keywords: ["更新", "安装更新", "检查更新", "upgrade"],
		effect: "write",
		approval: {
			defaultPresentation: "updater.check",
			presentations: [
				{ id: "updater.check", title: "检查更新确认", description: "确认检查应用更新。" },
				{ id: "updater.download", title: "下载更新确认", description: "确认下载更新包。" },
				{ id: "updater.install", title: "安装更新确认", description: "确认安装更新并可能重启。" },
				{ id: "updater.dismiss", title: "忽略更新提示确认", description: "确认忽略当前更新提示。" },
				{ id: "updater.cancel", title: "取消更新下载确认", description: "确认取消进行中的下载。" },
			],
			presentationByOperation: {
				check: "updater.check",
				download: "updater.download",
				install: "updater.install",
				dismiss: "updater.dismiss",
				cancel: "updater.cancel",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		handler: async ({ input }) => {
			switch (input.operation) {
				case "check":
					return { operation: input.operation, state: await ctx.official.updater.check() };
				case "download":
					return { operation: input.operation, state: await ctx.official.updater.download() };
				case "install":
					await ctx.official.updater.install();
					return { operation: input.operation, state: await ctx.official.updater.getState() };
				case "dismiss":
					await ctx.official.updater.dismiss();
					return { operation: input.operation, state: await ctx.official.updater.getState() };
				case "cancel":
					await ctx.official.updater.cancel();
					return { operation: input.operation, state: await ctx.official.updater.getState() };
			}
		},
	});
}
