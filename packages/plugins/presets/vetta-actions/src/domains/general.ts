import type {
	PluginAppActionExample,
	PluginContext,
	PluginJsonSchema,
} from "@vetta-org/plugin-sdk";
import { createVettaActionRegistrar } from "../action-usage";

type GeneralQueryInput = { operation: "help" } | { operation: "get" };
type GeneralManageInput =
	| { operation: "set-notifications"; enabled: boolean }
	| { operation: "set-execution-mode"; mode: "sandbox" | "full-access" }
	| { operation: "set-workspace"; path: string };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "get" } }, required: ["operation"], additionalProperties: false },
	],
};

const manageSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: { operation: { const: "set-notifications" }, enabled: { type: "boolean" } },
			required: ["operation", "enabled"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "set-execution-mode" },
				mode: { enum: ["sandbox", "full-access"] },
			},
			required: ["operation", "mode"],
			additionalProperties: false,
		},
		{
			properties: { operation: { const: "set-workspace" }, path: { type: "string", minLength: 1 } },
			required: ["operation", "path"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<GeneralQueryInput>[] = [
	{ description: "读取通用设置", input: { operation: "get" } },
];
const manageExamples: PluginAppActionExample<GeneralManageInput>[] = [
	{ description: "默认沙盒执行", input: { operation: "set-execution-mode", mode: "sandbox" } },
	{ description: "关闭系统通知", input: { operation: "set-notifications", enabled: false } },
];

export function registerGeneralActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "general");
	register<GeneralQueryInput>({
		id: "general.query",
		publicId: "general.query",
		title: "查询通用设置",
		summary: "读取工作区、通知与默认执行模式（设置 → 通用）。",
		description:
			'对象参数；operation 为 "help" 或 "get"。get 返回工作区、通知、默认执行模式与 sandbox 能力。',
		keywords: ["通用", "general", "通知", "沙盒", "workspace", "工作区", "执行模式", "设置"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"general 对应设置 → 通用。外观查询 → appearance.query；语言/主题变更 → appearance.theme；Agent 实验开关 → agent.query / agent.manage；知识库加工 → knowledge.query get-processing / knowledge.manage set-processing；模型/MCP 用 models.* / mcp.*。",
					actions: [
						{ id: "general.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "general.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			return ctx.official.general.getSettings();
		},
	});
	register<GeneralManageInput>({
		id: "general.manage",
		publicId: "general.manage",
		title: "修改通用设置",
		summary: "修改通知、默认执行模式或工作区路径。",
		description:
			'对象参数；operation 为 "set-notifications"、"set-execution-mode" 或 "set-workspace"。',
		keywords: ["通用", "通知", "沙盒", "full-access", "workspace", "工作区", "执行模式"],
		effect: "write",
		approval: {
			defaultPresentation: "general.set-notifications",
			presentations: [
				{ id: "general.set-notifications", title: "修改通知设置确认", description: "确认通知开关。" },
				{
					id: "general.set-execution-mode",
					title: "修改默认执行模式确认",
					description: "确认执行模式变更。",
				},
				{ id: "general.set-workspace", title: "修改工作区路径确认", description: "展示并可编辑工作区路径。" },
			],
			presentationByOperation: {
				"set-notifications": "general.set-notifications",
				"set-execution-mode": "general.set-execution-mode",
				"set-workspace": "general.set-workspace",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		handler: ({ input }) => ctx.official.general.setSettings(input),
	});
}
