import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { throwInvalidInput } from "../action-errors";

type ImQueryInput =
	| { operation: "help" }
	| { operation: "status" }
	| { operation: "logs"; limit?: number };
type ImManageInput =
	| { operation: "set-enabled"; enabled: boolean }
	| { operation: "restart" }
	| { operation: "set-agent-model"; modelKey: string | null; reasoningLevel?: string }
	| {
			operation: "set-feishu-config";
			/** 可省略；审批弹窗中由用户填写。 */
			appId?: string;
			/** 切勿由 Agent 填写真实密钥；留空，审批弹窗由用户手填。 */
			appSecret?: string;
			verificationToken?: string;
			encryptKey?: string;
			baseUrl?: string;
			enabled?: boolean;
	  };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "status" } }, required: ["operation"], additionalProperties: false },
		{
			properties: {
				operation: { const: "logs" },
				limit: { type: "integer", minimum: 1, maximum: 200 },
			},
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
				operation: { const: "set-enabled" },
				enabled: { type: "boolean" },
			},
			required: ["operation", "enabled"],
			additionalProperties: false,
		},
		{ properties: { operation: { const: "restart" } }, required: ["operation"], additionalProperties: false },
		{
			properties: {
				operation: { const: "set-agent-model" },
				modelKey: { type: ["string", "null"], minLength: 1 },
				reasoningLevel: { type: "string", minLength: 1 },
			},
			required: ["operation", "modelKey"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "set-feishu-config" },
				appId: { type: "string" },
				appSecret: { type: "string" },
				verificationToken: { type: "string" },
				encryptKey: { type: "string" },
				baseUrl: { type: "string" },
				enabled: { type: "boolean" },
			},
			required: ["operation"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<ImQueryInput>[] = [
	{ description: "查看 IM 状态", input: { operation: "status" } },
];
const manageExamples: PluginAppActionExample<ImManageInput>[] = [
	{ description: "启用 IM", input: { operation: "set-enabled", enabled: true } },
	{ description: "重启 IM", input: { operation: "restart" } },
	{
		description: "配置飞书凭证（密钥由用户在弹窗填写）",
		input: { operation: "set-feishu-config", appId: "cli_xxx" },
	},
];

export function registerImActions(ctx: PluginContext): void {
	ctx.appActions.register<ImQueryInput>({
		id: "im.query",
		publicId: "im.query",
		title: "查询 IM/Claw 状态",
		summary: "查看 IM 旁路桥接运行状态与日志。",
		description: '对象参数；operation 为 "help"、"status" 或 "logs"。不返回密钥。',
		keywords: ["im", "claw", "飞书", "微信", "旁路", "sidecar"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"写操作用 im.manage。配置飞书凭证用 set-feishu-config：不要在参数里传 appSecret/verificationToken/encryptKey，审批弹窗由用户手填密钥。",
					actions: [
						{ id: "im.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "im.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			if (input.operation === "status") return ctx.official.im.getStatus();
			return { logs: await ctx.official.im.getLogs(input.limit ?? 50) };
		},
	});
	ctx.appActions.register<ImManageInput>({
		id: "im.manage",
		publicId: "im.manage",
		title: "管理 IM/Claw",
		summary: "启停、重启、设置对话模型，或弹出飞书凭证配置（密钥由用户填写）。",
		description:
			'对象参数；operation 为 "set-enabled"、"restart"、"set-agent-model" 或 "set-feishu-config"。set-feishu-config 的密钥字段请省略，由审批弹窗手填。',
		keywords: ["im", "claw", "启用", "重启", "飞书", "凭证", "appSecret", "密钥"],
		effect: "write",
		approval: {
			defaultPresentation: "im.set-enabled",
			presentations: [
				{ id: "im.set-enabled", title: "启用/停用 IM 旁路确认", description: "展示 IM 旁路启用状态变更。" },
				{ id: "im.restart", title: "重启 IM 旁路确认", description: "确认重启本地 IM 旁路。" },
				{ id: "im.set-agent-model", title: "设置 IM Agent 模型确认", description: "展示并可编辑 IM Agent 模型。" },
				{
					id: "im.set-feishu-config",
					title: "配置飞书凭证确认",
					description: "展示飞书应用配置表单；密钥由用户手填，不经过 Agent。",
				},
			],
			presentationByOperation: {
				"set-enabled": "im.set-enabled",
				restart: "im.restart",
				"set-agent-model": "im.set-agent-model",
				"set-feishu-config": "im.set-feishu-config",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (input.operation !== "set-agent-model" || input.modelKey === null) return;
			const modelKey = input.modelKey;
			if (!/^[^/]+\/.+$/.test(modelKey)) {
				throwInvalidInput(
					`Refused set-agent-model before user approval: invalid modelKey=${JSON.stringify(modelKey)}. Expected "provider/modelId". Call models.query with {"operation":"list"}.`,
					{ operation: "set-agent-model", idField: "modelKey", id: modelKey },
				);
			}
			try {
				await ctx.official.im.assertModelKeyExists(modelKey);
			} catch (error) {
				throwInvalidInput(error instanceof Error ? error.message : String(error), {
					operation: "set-agent-model",
					modelKey,
				});
			}
		},
		handler: async ({ input }) => {
			if (input.operation === "restart") {
				return { operation: input.operation, ...(await ctx.official.im.restart()) };
			}
			if (input.operation === "set-agent-model") {
				return {
					operation: input.operation,
					...(await ctx.official.im.setAgentModel(input.modelKey, input.reasoningLevel)),
				};
			}
			if (input.operation === "set-feishu-config") {
				const result = await ctx.official.im.setFeishuConfig({
					appId: input.appId,
					appSecret: input.appSecret,
					verificationToken: input.verificationToken,
					encryptKey: input.encryptKey,
					baseUrl: input.baseUrl,
					enabled: input.enabled,
				});
				return { operation: input.operation, ...result };
			}
			return {
				operation: input.operation,
				enabled: input.enabled,
				...(await ctx.official.im.setEnabled(input.enabled)),
			};
		},
	});
}
