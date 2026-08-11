import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { throwInvalidInput } from "../action-errors";

type NavigationQueryInput = { type: "help" };
type NavigationOpenInput = {
	type: "open";
	target: string;
	tab?: string;
	section?: string;
	/** 仅带参数的目标（如 new-session）需要：项目绝对路径。 */
	cwd?: string;
	approvalUi?: string;
};

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [{ properties: { type: { const: "help" } }, required: ["type"], additionalProperties: false }],
};

const openSchema: PluginJsonSchema = {
	type: "object",
	properties: {
		type: { const: "open" },
		target: { type: "string", minLength: 1 },
		tab: { type: "string", minLength: 1 },
		section: { type: "string", minLength: 1 },
		cwd: { type: "string", minLength: 1 },
		approvalUi: { enum: ["navigation.open", "generic"] },
	},
	required: ["type", "target"],
	additionalProperties: false,
};

const queryExamples: PluginAppActionExample<NavigationQueryInput>[] = [
	{ description: "查看可导航页面目录", input: { type: "help" } },
];

const openExamples: PluginAppActionExample<NavigationOpenInput>[] = [
	{ description: "打开能力页", input: { type: "open", target: "skills" } },
	{ description: "打开模型配置", input: { type: "open", target: "models" } },
	{ description: "打开连接器", input: { type: "open", target: "connectors" } },
];

export function registerNavigationActions(ctx: PluginContext): void {
	ctx.appActions.register<NavigationQueryInput>({
		id: "navigation.query",
		publicId: "navigation.query",
		title: "查询可导航页面",
		summary: "列出可打开的应用页面与设置分类目录。",
		description:
			'对象参数：{ "type": "help" }。只读，不弹授权。打开页面请用 navigation.open。',
		keywords: ["open", "打开", "跳转", "导航", "页面", "settings", "设置", "目录", "help"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async () => ctx.official.navigation.help(),
	});

	ctx.appActions.register<NavigationOpenInput>({
		id: "navigation.open",
		publicId: "navigation.open",
		title: "打开应用页面",
		summary: "根据稳定页面 id 打开应用内页面；支持跳转到设置页分类和具体设置项。",
		description:
			'对象参数：{ "type": "open", "target": string, "tab"?: string, "section"?: string, "cwd"?: string }。cwd 只有带参数的目标（如 new-session）才需要。查询目录请用 navigation.query help。',
		keywords: [
			"open",
			"打开",
			"跳转",
			"导航",
			"页面",
			"settings",
			"设置",
			"技能广场",
			"下载中心",
			"自动化",
			"批量任务",
		],
		effect: "write",
		approval: {
			defaultPresentation: "navigation.open",
			presentations: [
				{
					id: "navigation.open",
					title: "页面跳转确认",
					description: "使用页面跳转专用审批界面。",
				},
			],
			presentationByOperation: {
				open: "navigation.open",
			},
		},
		inputSchema: openSchema,
		examples: openExamples,
		assertReady: async ({ input }) => {
			try {
				ctx.official.navigation.resolveOpen({
					target: input.target,
					tab: input.tab,
					section: input.section,
					cwd: input.cwd,
				});
			} catch (error) {
				throwInvalidInput(error instanceof Error ? error.message : String(error), {
					operation: "open",
					target: input.target,
					tab: input.tab,
					section: input.section,
					cwd: input.cwd,
				});
			}
		},
		handler: async ({ input }) => {
			return ctx.official.navigation.open({
				target: input.target,
				tab: input.tab,
				section: input.section,
				cwd: input.cwd,
			});
		},
	});
}
