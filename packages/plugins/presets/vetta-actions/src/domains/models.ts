import type {
	PluginAppActionExample,
	PluginContext,
	PluginJsonSchema,
	PluginOfficialProviderUpsertData,
} from "@vetta-org/plugin-sdk";
import { throwEntityNotFound, throwInvalidInput } from "../action-errors";

type ModelsQueryInput =
	| { operation: "help" }
	| { operation: "list" }
	| { operation: "get"; provider?: string }
	| { operation: "probe"; provider: string; model: string };
type ModelsManageInput =
	| { operation: "set-default"; modelKey: string }
	| { operation: "upsert-provider"; provider: string; data: PluginOfficialProviderUpsertData }
	| { operation: "remove-provider"; provider: string };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "list" } }, required: ["operation"], additionalProperties: false },
		{
			properties: {
				operation: { const: "get" },
				provider: { type: "string", minLength: 1 },
			},
			required: ["operation"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "probe" },
				provider: { type: "string", minLength: 1 },
				model: { type: "string", minLength: 1 },
			},
			required: ["operation", "provider", "model"],
			additionalProperties: false,
		},
	],
};

const manageSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				operation: { const: "set-default" },
				modelKey: { type: "string", minLength: 1, pattern: "^[^/]+/.+$" },
			},
			required: ["operation", "modelKey"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "upsert-provider" },
				provider: { type: "string", minLength: 1 },
				data: { type: "object", minProperties: 1 },
			},
			required: ["operation", "provider", "data"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "remove-provider" },
				provider: { type: "string", minLength: 1 },
			},
			required: ["operation", "provider"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<ModelsQueryInput>[] = [
	{ description: "列出模型配置", input: { operation: "list" } },
	{ description: "探测模型可达性", input: { operation: "probe", provider: "openai", model: "gpt-4o" } },
];
const manageExamples: PluginAppActionExample<ModelsManageInput>[] = [
	{ description: "设置默认模型", input: { operation: "set-default", modelKey: "openai/gpt-4o" } },
	{
		description: "创建/更新服务商（API Key 由用户在审批弹窗填写，勿在参数中传真实密钥）",
		input: {
			operation: "upsert-provider",
			provider: "openai",
			data: { baseUrl: "https://api.openai.com/v1", displayName: "OpenAI" },
		},
	},
];

export function registerModelsActions(ctx: PluginContext): void {
	ctx.appActions.register<ModelsQueryInput>({
		id: "models.query",
		publicId: "models.query",
		title: "查询模型配置",
		summary: "查看默认模型、provider 列表，或探测模型服务可达性。返回结果会脱敏密钥。",
		description: '对象参数；operation 为 "help"、"list"、"get" 或 "probe"。返回结果会脱敏 apiKey/headers。',
		keywords: ["模型", "model", "provider", "服务商", "defaultModel", "API Key", "probe", "默认模型"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"写操作使用 models.manage。list/get 返回的 apiKey 为 ***，不要把脱敏值写回 upsert。upsert-provider 时省略 apiKey，审批弹窗会让用户手填密钥。",
					actions: [
						{ id: "models.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "models.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			if (input.operation === "probe") {
				return ctx.official.models.probe(input.provider, input.model);
			}
			if (input.operation === "list") return ctx.official.models.list();
			return ctx.official.models.get(input.provider);
		},
	});
	ctx.appActions.register<ModelsManageInput>({
		id: "models.manage",
		publicId: "models.manage",
		title: "管理模型配置",
		summary: "设置默认模型，创建或更新 provider，删除 provider。",
		description:
			'对象参数；operation 为 "set-default"、"upsert-provider" 或 "remove-provider"。modelKey 格式为 "provider/modelId"。upsert 为 patch；apiKey 请省略，由审批弹窗手填。',
		keywords: ["模型", "model", "provider", "默认模型", "API Key", "服务商", "set-default", "密钥"],
		effect: "write",
		approval: {
			defaultPresentation: "models.set-default",
			presentations: [
				{ id: "models.set-default", title: "设置默认模型确认", description: "确认默认对话模型变更。" },
				{ id: "models.upsert-provider", title: "创建或更新模型服务商确认", description: "展示并可编辑服务商配置。" },
				{ id: "models.remove-provider", title: "删除模型服务商确认", description: "展示待删除服务商。" },
			],
			presentationByOperation: {
				"set-default": "models.set-default",
				"upsert-provider": "models.upsert-provider",
				"remove-provider": "models.remove-provider",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (input.operation === "set-default") {
				try {
					await ctx.official.models.assertModelKeyExists(input.modelKey, input.operation);
				} catch (error) {
					throwInvalidInput(error instanceof Error ? error.message : String(error), {
						operation: input.operation,
						modelKey: input.modelKey,
					});
				}
				return;
			}
			if (input.operation === "remove-provider") {
				const ids = await ctx.official.models.listProviderIds();
				if (ids.includes(input.provider)) return;
				throwEntityNotFound({
					operation: input.operation,
					entity: "model provider",
					idField: "provider",
					id: input.provider,
					queryAction: "models.query",
					queryExample: { operation: "list" },
					resultIdPath: "providers[].id",
					availableIds: ids,
				});
			}
		},
		handler: async ({ input }) => {
			if (input.operation === "set-default") {
				return {
					operation: input.operation,
					...(await ctx.official.models.setDefault(input.modelKey)),
				};
			}
			if (input.operation === "remove-provider") {
				await ctx.official.models.removeProvider(input.provider);
				return { operation: input.operation, provider: input.provider };
			}
			return {
				operation: input.operation,
				provider: input.provider,
				config: await ctx.official.models.upsertProvider(input.provider, input.data),
			};
		},
	});
}
