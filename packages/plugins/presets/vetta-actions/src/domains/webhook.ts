import type {
	PluginAppActionExample,
	PluginContext,
	PluginJsonSchema,
	PluginOfficialWebhookKind,
	PluginOfficialWebhookMessage,
	PluginOfficialWebhookUpdateInput,
} from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";
import { createVettaActionRegistrar } from "../action-usage";

type WebhookQueryInput =
	| { operation: "help" }
	| { operation: "list" }
	| { operation: "list-providers" };
type WebhookManageInput =
	| {
			operation: "create";
			kind: PluginOfficialWebhookKind;
			name?: string;
			webhookUrl: string;
			signSecret?: string;
			enabled?: boolean;
	  }
	| { operation: "update"; id: string; data: PluginOfficialWebhookUpdateInput }
	| { operation: "set-enabled"; id: string; enabled: boolean }
	| { operation: "delete"; id: string }
	| { operation: "test"; id: string }
	| ({ operation: "send"; id: string } & PluginOfficialWebhookMessage);

const querySchema: PluginJsonSchema = {
	type: "object",
	properties: { operation: { enum: ["help", "list", "list-providers"] } },
	required: ["operation"],
	additionalProperties: false,
};
const manageSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				operation: { const: "create" },
				kind: { enum: ["feishu", "dingtalk"] },
				name: { type: "string", minLength: 1 },
				webhookUrl: { type: "string", minLength: 1 },
				signSecret: { type: "string" },
				enabled: { type: "boolean" },
			},
			required: ["operation", "kind", "webhookUrl"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "update" },
				id: { type: "string", minLength: 1 },
				data: {
					type: "object",
					properties: {
						name: { type: "string", minLength: 1 },
						enabled: { type: "boolean" },
						webhookUrl: { type: "string", minLength: 1 },
						signSecret: { type: "string" },
					},
					minProperties: 1,
					additionalProperties: false,
				},
			},
			required: ["operation", "id", "data"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "set-enabled" },
				id: { type: "string", minLength: 1 },
				enabled: { type: "boolean" },
			},
			required: ["operation", "id", "enabled"],
			additionalProperties: false,
		},
		...(["delete", "test"] as const).map((operation) => ({
			properties: { operation: { const: operation }, id: { type: "string", minLength: 1 } },
			required: ["operation", "id"],
			additionalProperties: false,
		})),
		{
			properties: {
				operation: { const: "send" },
				id: { type: "string", minLength: 1 },
				text: { type: "string", minLength: 1 },
				title: { type: "string" },
				level: { enum: ["info", "warn", "error", "success"] },
			},
			required: ["operation", "id", "text"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<WebhookQueryInput>[] = [
	{ description: "列出 webhook", input: { operation: "list" } },
];
const manageExamples: PluginAppActionExample<WebhookManageInput>[] = [
	{
		description: "创建飞书 webhook",
		input: {
			operation: "create",
			kind: "feishu",
			name: "通知机器人",
			webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
		},
	},
	{ description: "发送测试", input: { operation: "test", id: "..." } },
];

const approvalPresentations = [
	{ id: "webhook.create", title: "创建 Webhook 确认", description: "展示并可编辑 Webhook 配置。" },
	{ id: "webhook.update", title: "更新 Webhook 确认", description: "加载当前配置并允许编辑后确认。" },
	{ id: "webhook.set-enabled", title: "启用/停用 Webhook 确认", description: "展示 Webhook 启用状态变更。" },
	{ id: "webhook.delete", title: "删除 Webhook 确认", description: "展示待删除 Webhook。" },
	{ id: "webhook.test", title: "测试 Webhook 确认", description: "确认发送测试消息。" },
	{ id: "webhook.send", title: "发送 Webhook 消息确认", description: "展示并可编辑消息内容。" },
];

export function registerWebhookActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "webhook");
	register<WebhookQueryInput>({
		id: "webhook.query",
		publicId: "webhook.query",
		title: "查询消息推送",
		summary: "列出 Webhook 端点与支持的 provider。",
		description:
			'对象参数；operation 为 "help"、"list" 或 "list-providers"。list 仅返回 urlMask。',
		keywords: ["webhook", "推送", "飞书", "钉钉", "通知", "机器人"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance: "list 只返回脱敏 urlMask；完整 URL 仅在 create/update 时提交。",
					actions: [
						{ id: "webhook.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "webhook.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			return input.operation === "list-providers"
				? { providers: await ctx.official.webhook.listProviders() }
				: { endpoints: await ctx.official.webhook.list() };
		},
	});
	register<WebhookManageInput>({
		id: "webhook.manage",
		publicId: "webhook.manage",
		title: "管理消息推送",
		summary: "创建、更新、启停、删除 Webhook，或发送测试/自定义消息。",
		description:
			'对象参数；operation 为 "create"、"update"、"set-enabled"、"delete"、"test" 或 "send"。',
		keywords: ["webhook", "推送", "飞书", "钉钉", "机器人", "发送"],
		effect: "write",
		approval: {
			defaultPresentation: "webhook.create",
			presentations: approvalPresentations,
			presentationByOperation: Object.fromEntries(
				approvalPresentations.map((presentation) => [presentation.id.slice("webhook.".length), presentation.id]),
			),
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (input.operation === "create") return;
			const endpoints = await ctx.official.webhook.list();
			if (endpoints.some((endpoint) => endpoint.id === input.id)) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "webhook endpoint",
				idField: "id",
				id: input.id,
				queryAction: "webhook.query",
				queryExample: { operation: "list" },
				resultIdPath: "endpoints[].id",
				availableIds: endpoints.map((endpoint) => endpoint.id),
				extra: "Do not use display name or urlMask as id.",
			});
		},
		handler: async ({ input }) => {
			switch (input.operation) {
				case "create":
					return {
						operation: input.operation,
						endpoint: await ctx.official.webhook.create({
							kind: input.kind,
							name: input.name?.trim() || `${input.kind} bot`,
							webhookUrl: input.webhookUrl,
							signSecret: input.signSecret,
							enabled: input.enabled,
						}),
					};
				case "update":
					return {
						operation: input.operation,
						endpoint: await ctx.official.webhook.update(input.id, input.data),
					};
				case "set-enabled":
					return {
						operation: input.operation,
						endpoint: await ctx.official.webhook.setEnabled(input.id, input.enabled),
					};
				case "delete":
					await ctx.official.webhook.delete(input.id);
					return { operation: input.operation, id: input.id };
				case "test":
					return { operation: input.operation, result: await ctx.official.webhook.test(input.id) };
				case "send":
					return {
						operation: input.operation,
						result: await ctx.official.webhook.send(input.id, {
							text: input.text,
							title: input.title,
							level: input.level,
						}),
					};
			}
		},
	});
}
