import type {
	PluginAppActionExample,
	PluginContext,
	PluginJsonSchema,
	PluginOfficialExperimentalSettings,
} from "@vetta-org/plugin-sdk";

type AgentQueryInput = { operation: "help" } | { operation: "get" };
type AgentManageInput = {
	operation: "set-experimental";
	data: Partial<PluginOfficialExperimentalSettings>;
};

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "get" } }, required: ["operation"], additionalProperties: false },
	],
};

const manageSchema: PluginJsonSchema = {
	type: "object",
	properties: {
		operation: { const: "set-experimental" },
		data: {
			type: "object",
			properties: {
				vettaCli: { type: "boolean" },
				promptPrediction: { type: "boolean" },
				agentSkills: { type: "boolean" },
			},
			minProperties: 1,
			additionalProperties: false,
		},
	},
	required: ["operation", "data"],
	additionalProperties: false,
};

const queryExamples: PluginAppActionExample<AgentQueryInput>[] = [
	{ description: "读取 Agent 实验开关", input: { operation: "get" } },
];
const manageExamples: PluginAppActionExample<AgentManageInput>[] = [
	{
		description: "开启输入预测",
		input: { operation: "set-experimental", data: { promptPrediction: true } },
	},
];

export function registerAgentActions(ctx: PluginContext): void {
	ctx.appActions.register<AgentQueryInput>({
		id: "agent.query",
		publicId: "agent.query",
		title: "查询 Agent 配置",
		summary: "读取 Agent 实验开关（设置 → Agent 配置）。",
		description:
			'对象参数；operation 为 "help" 或 "get"。get 返回 Agent 实验开关快照。对应设置 → Agent 配置。',
		keywords: ["agent", "Agent", "实验", "experimental", "Vetta CLI", "输入预测", "技能扩展", "agentSkills"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"agent 对应设置 → Agent 配置的实验开关。工作区/通知/执行模式 → general.*；外观查询 → appearance.query；语言/主题变更 → appearance.theme；能力（skill/scene）启停与市场安装 → skills.*。",
					actions: [
						{ id: "agent.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "agent.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			return { experimental: await ctx.official.agent.getExperimental() };
		},
	});
	ctx.appActions.register<AgentManageInput>({
		id: "agent.manage",
		publicId: "agent.manage",
		title: "修改 Agent 配置",
		summary: "修改 Agent 实验功能开关。",
		description: '对象参数；operation 为 "set-experimental"。data 至少包含一个实验功能开关。',
		keywords: ["agent", "实验", "experimental", "vettaCli", "promptPrediction", "agentSkills"],
		effect: "write",
		approval: {
			defaultPresentation: "agent.set-experimental",
			presentations: [
				{ id: "agent.set-experimental", title: "修改实验功能确认", description: "确认实验功能变更。" },
			],
			presentationByOperation: { "set-experimental": "agent.set-experimental" },
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		handler: async ({ input }) => ({
			operation: input.operation,
			experimental: await ctx.official.agent.setExperimental(input.data),
		}),
	});
}
