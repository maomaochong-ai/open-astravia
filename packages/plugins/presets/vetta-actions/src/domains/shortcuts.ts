import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";
import { createVettaActionRegistrar } from "../action-usage";

type ShortcutsQueryInput = { operation: "help" } | { operation: "get" };
type ShortcutsManageInput =
	| { operation: "set-binding"; id: string; shortcut: string }
	| { operation: "reset-binding"; id: string }
	| { operation: "reset-all-bindings" }
	| { operation: "set-quick-panel-trigger"; trigger: "none" | "mod" | "alt" | "shift" }
	| { operation: "set-quick-panel-behavior"; behavior: "foreground" | "background" };

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
			properties: {
				operation: { const: "set-binding" },
				id: { type: "string", minLength: 1 },
				shortcut: { type: "string", minLength: 1 },
			},
			required: ["operation", "id", "shortcut"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "reset-binding" },
				id: { type: "string", minLength: 1 },
			},
			required: ["operation", "id"],
			additionalProperties: false,
		},
		{
			properties: { operation: { const: "reset-all-bindings" } },
			required: ["operation"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "set-quick-panel-trigger" },
				trigger: { enum: ["none", "mod", "alt", "shift"] },
			},
			required: ["operation", "trigger"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "set-quick-panel-behavior" },
				behavior: { enum: ["foreground", "background"] },
			},
			required: ["operation", "behavior"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<ShortcutsQueryInput>[] = [
	{ description: "查看快捷键域说明与可用 id", input: { operation: "help" } },
	{ description: "读取全局绑定 + 快捷面板设置", input: { operation: "get" } },
];
const manageExamples: PluginAppActionExample<ShortcutsManageInput>[] = [
	{
		description: "把新建会话改为 mod+shift+n",
		input: { operation: "set-binding", id: "new-session", shortcut: "mod+shift+n" },
	},
	{ description: "恢复打开项目默认键", input: { operation: "reset-binding", id: "open-project" } },
	{ description: "全部恢复默认全局绑定", input: { operation: "reset-all-bindings" } },
	{ description: "启用双击 mod 呼出快捷面板", input: { operation: "set-quick-panel-trigger", trigger: "mod" } },
	{ description: "快捷面板发送后后台运行", input: { operation: "set-quick-panel-behavior", behavior: "background" } },
];

export function registerShortcutsActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "shortcuts");
	register<ShortcutsQueryInput>({
		id: "shortcuts.query",
		publicId: "shortcuts.query",
		title: "查询快捷键设置",
		summary: "读取设置 → 快捷键：全局应用快捷键绑定与快捷面板呼出/发送后行为。",
		description:
			'对象参数；operation 为 "help" 或 "get"。对应设置 → 快捷键整页：全局应用快捷键 + 快捷面板呼出/发送后行为。',
		keywords: [
			"快捷键",
			"shortcut",
			"hotkey",
			"键盘",
			"绑定",
			"keybinding",
			"new-session",
			"open-project",
			"open-settings",
			"全局快捷键",
			"快捷面板",
			"quick panel",
			"双击",
		],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance:
						"shortcuts 对应设置 → 快捷键整页。bindings：new-session / open-project / open-settings；quickPanel：双击功能键呼出与发送后行为。",
					availableActions: ctx.official.shortcuts.listAvailableActions(),
					quickPanelOptions: {
						trigger: ["none", "mod", "alt", "shift"],
						postSendBehavior: ["foreground", "background"],
					},
					actions: [
						{ id: "shortcuts.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "shortcuts.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			return ctx.official.shortcuts.get();
		},
	});
	register<ShortcutsManageInput>({
		id: "shortcuts.manage",
		publicId: "shortcuts.manage",
		title: "修改快捷键设置",
		summary: "修改设置 → 快捷键：全局绑定或快捷面板呼出/发送后行为。",
		description:
			'对象参数；operation 为 "set-binding" | "reset-binding" | "reset-all-bindings" | "set-quick-panel-trigger" | "set-quick-panel-behavior"。',
		keywords: ["快捷键", "shortcut", "重置快捷键", "keybinding", "快捷面板", "quick panel", "双击"],
		effect: "write",
		approval: {
			defaultPresentation: "shortcuts.set-binding",
			presentations: [
				{ id: "shortcuts.set-binding", title: "修改快捷键绑定确认", description: "展示并可编辑目标动作与组合键。" },
				{ id: "shortcuts.reset-binding", title: "恢复单项快捷键确认", description: "确认将单个动作恢复默认键。" },
				{
					id: "shortcuts.reset-all-bindings",
					title: "恢复全部全局快捷键确认",
					description: "确认将全部全局应用快捷键恢复默认。",
				},
				{
					id: "shortcuts.set-quick-panel-trigger",
					title: "修改快捷面板触发确认",
					description: "确认双击功能键呼出方式。",
				},
				{
					id: "shortcuts.set-quick-panel-behavior",
					title: "修改快捷面板发送后行为确认",
					description: "确认发送后前台/后台行为。",
				},
			],
			presentationByOperation: {
				"set-binding": "shortcuts.set-binding",
				"reset-binding": "shortcuts.reset-binding",
				"reset-all-bindings": "shortcuts.reset-all-bindings",
				"set-quick-panel-trigger": "shortcuts.set-quick-panel-trigger",
				"set-quick-panel-behavior": "shortcuts.set-quick-panel-behavior",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (input.operation !== "set-binding" && input.operation !== "reset-binding") return;
			const available = ctx.official.shortcuts.listAvailableActions();
			if (available.some((action) => action.id === input.id)) return;
			throwEntityNotFound({
				operation: input.operation,
				entity: "shortcut action",
				idField: "id",
				id: input.id,
				queryAction: "shortcuts.query",
				queryExample: { operation: "help" },
				resultIdPath: "availableActions[].id",
				availableIds: available.map((action) => action.id),
			});
		},
		handler: async ({ input }) => {
			if (input.operation === "set-binding") {
				const result = await ctx.official.shortcuts.setBinding(input.id, input.shortcut);
				return { operation: input.operation, id: input.id, shortcut: input.shortcut, ...result };
			}
			if (input.operation === "reset-binding") {
				const result = await ctx.official.shortcuts.resetBinding(input.id);
				return { operation: input.operation, id: input.id, ...result };
			}
			if (input.operation === "reset-all-bindings") {
				return { operation: input.operation, ...(await ctx.official.shortcuts.resetAllBindings()) };
			}
			if (input.operation === "set-quick-panel-trigger") {
				return {
					operation: input.operation,
					quickPanel: await ctx.official.shortcuts.setQuickPanelTrigger(input.trigger),
				};
			}
			return {
				operation: input.operation,
				quickPanel: await ctx.official.shortcuts.setQuickPanelBehavior(input.behavior),
			};
		},
	});
}
