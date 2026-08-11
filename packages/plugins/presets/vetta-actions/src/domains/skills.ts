import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { throwEntityNotFound, throwInvalidInput } from "../action-errors";

/**
 * 公共 id 仍为 skills.*（兼容既有 CLI/Agent 调用）。
 * 产品文案统一为「能力」（能力页 / 能力市场），涵盖 skill 与 scene 两种类型。
 */

type SkillsQueryInput =
	| { operation: "help" }
	| { operation: "list"; cwd?: string }
	| { operation: "manifest" };
type SkillsManageInput =
	| { operation: "set-enabled"; name: string; enabled: boolean }
	| { operation: "uninstall"; name: string; type?: "skill" | "scene" }
	| { operation: "install-from-market"; type: "skill" | "scene"; slug: string };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{
			properties: {
				operation: { const: "list" },
				cwd: { type: "string", minLength: 1 },
			},
			required: ["operation"],
			additionalProperties: false,
		},
		{ properties: { operation: { const: "manifest" } }, required: ["operation"], additionalProperties: false },
	],
};

const manageSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				operation: { const: "set-enabled" },
				name: { type: "string", minLength: 1 },
				enabled: { type: "boolean" },
			},
			required: ["operation", "name", "enabled"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "uninstall" },
				name: { type: "string", minLength: 1 },
				type: { enum: ["skill", "scene"] },
			},
			required: ["operation", "name"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "install-from-market" },
				type: { enum: ["skill", "scene"] },
				slug: { type: "string", minLength: 1, pattern: "\\S" },
			},
			required: ["operation", "type", "slug"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<SkillsQueryInput>[] = [
	{ description: "列出已可见能力（skill/scene）", input: { operation: "list" } },
	{ description: "查看本地已安装能力清单", input: { operation: "manifest" } },
];
const manageExamples: PluginAppActionExample<SkillsManageInput>[] = [
	{ description: "停用能力", input: { operation: "set-enabled", name: "my-skill", enabled: false } },
	{ description: "卸载能力", input: { operation: "uninstall", name: "my-skill" } },
	{
		description: "从能力市场安装",
		input: { operation: "install-from-market", type: "skill", slug: "create-skill" },
	},
];

export function registerSkillsActions(ctx: PluginContext): void {
	ctx.appActions.register<SkillsQueryInput>({
		id: "skills.query",
		publicId: "skills.query",
		title: "查询能力",
		summary: "列出可见能力（skill/scene），或读取本地安装清单。对应能力页。",
		description:
			'对象参数；operation 为 "help"、"list" 或 "manifest"。list 可传 cwd 以包含项目级能力。安装请用 skills.manage install-from-market。',
		keywords: ["能力", "abilities", "技能", "skill", "scene", "技能广场", "能力页", "manifest", "市场"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"产品「能力页」管理 skill/scene（公共 Action id 仍为 skills.*）。list/manifest 只读；install-from-market / set-enabled / uninstall 用 skills.manage。MCP/插件能力用 mcp.* / plugins.*。",
					actions: [
						{ id: "skills.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "skills.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			if (input.operation === "manifest") return ctx.official.skills.getManifest();
			return ctx.official.skills.list(input.cwd);
		},
	});
	ctx.appActions.register<SkillsManageInput>({
		id: "skills.manage",
		publicId: "skills.manage",
		title: "管理能力",
		summary: "从能力市场安装，或启用/停用/卸载已安装的 skill/scene。",
		description:
			'对象参数；operation 为 "set-enabled"、"uninstall" 或 "install-from-market"。install 传 type+slug；装完后出现在能力页与 manifest。',
		keywords: ["能力", "abilities", "技能", "skill", "启用", "停用", "卸载", "安装", "市场", "install"],
		effect: "write",
		approval: {
			defaultPresentation: "skills.set-enabled",
			presentations: [
				{ id: "skills.set-enabled", title: "启用/停用能力确认", description: "展示能力启用状态变更。" },
				{ id: "skills.uninstall", title: "卸载能力确认", description: "展示待卸载能力。" },
				{
					id: "skills.install-from-market",
					title: "从能力市场安装确认",
					description: "确认从市场下载并安装该能力。",
				},
			],
			presentationByOperation: {
				"set-enabled": "skills.set-enabled",
				uninstall: "skills.uninstall",
				"install-from-market": "skills.install-from-market",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (input.operation === "install-from-market") {
				if (!input.slug.trim()) {
					throwInvalidInput("install-from-market requires a non-empty slug", {
						operation: input.operation,
						type: input.type,
					});
				}
				return;
			}
			const manifest = await ctx.official.skills.getManifest();
			const entry = manifest[input.name];
			if (!entry) {
				throwEntityNotFound({
					operation: input.operation,
					entity: "installed ability (skill/scene)",
					idField: "name",
					id: input.name,
					queryAction: "skills.query",
					queryExample: { operation: "manifest" },
					resultIdPath: "object keys of the manifest / list items[].name",
					availableIds: Object.keys(manifest),
					extra: 'You may also call skills.query with {"operation":"list"}.',
				});
			}
			if (input.operation === "uninstall" && input.type) {
				const actualType = entry.type === "scene" ? "scene" : "skill";
				if (actualType !== input.type) {
					throwInvalidInput(
						`Refused uninstall before user approval: name=${JSON.stringify(input.name)} has type=${JSON.stringify(actualType)}, but you passed type=${JSON.stringify(input.type)}.`,
						{ operation: input.operation, name: input.name, type: actualType, requestedType: input.type },
					);
				}
			}
		},
		handler: async ({ input }) => {
			if (input.operation === "install-from-market") {
				const result = await ctx.official.skills.installFromMarket(input.type, input.slug.trim());
				return { operation: input.operation, ...result };
			}
			if (input.operation === "set-enabled") {
				return {
					operation: input.operation,
					...(await ctx.official.skills.setEnabled(input.name, input.enabled)),
				};
			}
			await ctx.official.skills.uninstall(input.name, input.type);
			return { operation: input.operation, name: input.name, type: input.type ?? null };
		},
	});
}
