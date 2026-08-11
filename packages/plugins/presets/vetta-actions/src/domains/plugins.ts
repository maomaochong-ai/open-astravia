import {
	PluginAppActionError,
	type PluginAppActionExample,
	type PluginContext,
	type PluginJsonSchema,
} from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";

type PluginsQueryInput =
	| { operation: "help" }
	| { operation: "list" }
	| { operation: "get"; id: string };
type PluginsManageInput =
	| { operation: "set-enabled"; id: string; enabled: boolean }
	| { operation: "install-from-url"; url: string }
	| {
			operation: "install-from-path";
			path: string;
			grantedPermissions?: string[];
			enable?: boolean;
			source?: "archive" | "npm";
			expectedSha256?: string;
			expectedId?: string;
			expectedVersion?: string;
			npm?: {
				packageName: string;
				requestedSpec: string;
				resolvedVersion: string;
				integrity?: string;
			};
	  }
	| { operation: "uninstall"; id: string }
	| { operation: "reload"; id: string };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "list" } }, required: ["operation"], additionalProperties: false },
		{
			properties: {
				operation: { const: "get" },
				id: { type: "string", minLength: 1 },
			},
			required: ["operation", "id"],
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
				id: { type: "string", minLength: 1 },
				enabled: { type: "boolean" },
			},
			required: ["operation", "id", "enabled"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "install-from-url" },
				url: { type: "string", minLength: 1 },
			},
			required: ["operation", "url"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "install-from-path" },
				path: { type: "string", minLength: 1 },
				grantedPermissions: { type: "array", items: { type: "string" } },
				enable: { type: "boolean" },
				source: { const: "archive" },
				expectedSha256: { type: "string", minLength: 64, maxLength: 64 },
			},
			required: ["operation", "path"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "install-from-path" },
				path: { type: "string", minLength: 1 },
				enable: { type: "boolean" },
				source: { const: "npm" },
				expectedSha256: { type: "string", minLength: 64, maxLength: 64 },
				expectedId: { type: "string", minLength: 1 },
				expectedVersion: { type: "string", minLength: 1 },
				npm: {
					type: "object",
					properties: {
						packageName: { type: "string", minLength: 1 },
						requestedSpec: { type: "string", minLength: 1 },
						resolvedVersion: { type: "string", minLength: 1 },
						integrity: { type: "string", minLength: 1 },
					},
					required: ["packageName", "requestedSpec", "resolvedVersion"],
					additionalProperties: false,
				},
			},
			required: ["operation", "path", "source", "expectedSha256", "expectedId", "expectedVersion", "npm"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "uninstall" },
				id: { type: "string", minLength: 1 },
			},
			required: ["operation", "id"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "reload" },
				id: { type: "string", minLength: 1 },
			},
			required: ["operation", "id"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<PluginsQueryInput>[] = [
	{ description: "列出插件", input: { operation: "list" } },
];
const manageExamples: PluginAppActionExample<PluginsManageInput>[] = [
	{ description: "停用插件", input: { operation: "set-enabled", id: "my-plugin", enabled: false } },
	{ description: "从 URL 安装", input: { operation: "install-from-url", url: "https://example.com/plugin.zip" } },
	{
		description: "从本地 zip 安装",
		input: { operation: "install-from-path", path: "/abs/path/to/my-plugin-0.1.0.zip" },
	},
];

export function registerPluginsActions(ctx: PluginContext): void {
	ctx.appActions.register<PluginsQueryInput>({
		id: "plugins.query",
		publicId: "plugins.query",
		title: "查询插件",
		summary: "列出或查看已安装插件。",
		description: '对象参数；operation 为 "help"、"list" 或 "get"。',
		keywords: ["插件", "plugin", "扩展", "extension"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance: "写操作使用 plugins.manage。系统插件不可卸载。",
					actions: [
						{ id: "plugins.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "plugins.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			if (input.operation === "list") return { plugins: await ctx.official.plugins.list() };
			return { plugin: await ctx.official.plugins.get(input.id) };
		},
	});
	ctx.appActions.register<PluginsManageInput>({
		id: "plugins.manage",
		publicId: "plugins.manage",
		title: "管理插件",
		summary: "启用/停用、从 URL 安装、卸载或重新加载插件。",
		description:
			'对象参数；operation 为 "set-enabled"、"install-from-url"、"install-from-path"、"uninstall" 或 "reload"。',
		keywords: ["插件", "plugin", "安装", "卸载", "启用"],
		effect: "write",
		approval: {
			defaultPresentation: "plugins.set-enabled",
			presentations: [
				{ id: "plugins.set-enabled", title: "启用/停用插件确认", description: "展示插件启用状态变更。" },
				{ id: "plugins.install-from-url", title: "从 URL 安装插件确认", description: "展示并可编辑安装地址。" },
				{
					id: "plugins.install-from-path",
					title: "从本地路径安装插件确认",
					description: "展示 zip 路径；确认后按声明一次授权并启用。",
				},
				{ id: "plugins.uninstall", title: "卸载插件确认", description: "展示待卸载插件。" },
				{ id: "plugins.reload", title: "重载插件确认", description: "展示待重载插件。" },
			],
			presentationByOperation: {
				"set-enabled": "plugins.set-enabled",
				"install-from-url": "plugins.install-from-url",
				"install-from-path": "plugins.install-from-path",
				uninstall: "plugins.uninstall",
				reload: "plugins.reload",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (input.operation === "install-from-url" || input.operation === "install-from-path") return;
			const plugins = await ctx.official.plugins.list();
			const target = plugins.find((item) => item.id === input.id);
			if (
				target?.required &&
				(input.operation === "uninstall" || (input.operation === "set-enabled" && !input.enabled))
			) {
				throw new PluginAppActionError(
					"PLUGIN_REQUIRED",
					`Required Action plugin cannot be ${input.operation === "uninstall" ? "uninstalled" : "disabled"}.`,
					{ pluginId: input.id },
				);
			}
			if (target) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "plugin",
				idField: "id",
				id: input.id,
				queryAction: "plugins.query",
				queryExample: { operation: "list" },
				resultIdPath: "plugins[].id",
				availableIds: plugins.map((item) => item.id),
				extra: "Use the plugin id field, not the display name.",
			});
		},
		handler: async ({ input }) => {
			if (input.operation === "set-enabled") {
				return {
					operation: input.operation,
					plugin: await ctx.official.plugins.setEnabled(input.id, input.enabled),
				};
			}
			if (input.operation === "install-from-url") {
				return {
					operation: input.operation,
					plugin: await ctx.official.plugins.installFromUrl(input.url),
				};
			}
			if (input.operation === "install-from-path") {
				return {
					operation: input.operation,
					plugin: await ctx.official.plugins.installFromPath(input.path, {
						grantedPermissions: input.grantedPermissions,
						enable: input.enable,
						source: input.source,
						expectedSha256: input.expectedSha256,
						expectedId: input.expectedId,
						expectedVersion: input.expectedVersion,
						npm: input.npm,
					}),
				};
			}
			if (input.operation === "uninstall") {
				await ctx.official.plugins.uninstall(input.id);
				return { operation: input.operation, id: input.id };
			}
			return {
				operation: input.operation,
				plugin: await ctx.official.plugins.reload(input.id),
			};
		},
	});
}
