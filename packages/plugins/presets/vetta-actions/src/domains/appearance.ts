import {
	PluginAppActionError,
	type PluginAppActionExample,
	type PluginContext,
	type PluginJsonSchema,
} from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";
import { createVettaActionRegistrar } from "../action-usage";

type ThemeQueryInput = { type: "help" } | { type: "get" };

type ThemeManageInput =
	| {
			type: "set";
			mode?: "light" | "dark" | "auto";
			themeId?: string;
			cursorStyle?: "default" | "stoat";
			approvalUi?: string;
	  }
	| { type: "set-language"; language: "zh" | "en"; approvalUi?: string };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { type: { const: "help" } }, required: ["type"], additionalProperties: false },
		{ properties: { type: { const: "get" } }, required: ["type"], additionalProperties: false },
	],
};

const manageSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				type: { const: "set" },
				mode: { enum: ["light", "dark", "auto"] },
				themeId: { type: "string", minLength: 1 },
				cursorStyle: { enum: ["default", "stoat"] },
				approvalUi: {
					enum: ["appearance.theme-change", "appearance.picker", "generic"],
				},
			},
			required: ["type"],
			additionalProperties: false,
		},
		{
			properties: {
				type: { const: "set-language" },
				language: { enum: ["zh", "en"] },
				approvalUi: { enum: ["appearance.set-language", "generic"] },
			},
			required: ["type", "language"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<ThemeQueryInput>[] = [
	{ description: "查看可用主题", input: { type: "help" } },
	{ description: "获取当前外观", input: { type: "get" } },
];

const manageExamples: PluginAppActionExample<ThemeManageInput>[] = [
	{ description: "切换深色默认主题", input: { type: "set", mode: "dark", themeId: "default" } },
	{ description: "切换界面语言为英文", input: { type: "set-language", language: "en" } },
];

export function registerAppearanceActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "appearance");
	register<ThemeQueryInput>({
		id: "appearance.query",
		publicId: "appearance.query",
		title: "查询外观",
		summary: "读取当前显示模式、主题、指针样式与界面语言；查看可用主题列表。",
		description:
			'对象参数：{ "type": "help" } 或 { "type": "get" }。只读，不弹授权。变更外观请用 appearance.theme。',
		keywords: ["theme", "主题", "外观", "深色", "浅色", "dark", "light", "语言", "language", "cursor", "鼠标"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.type === "help") return ctx.official.appearance.help();
			return ctx.official.appearance.get();
		},
	});

	register<ThemeManageInput>({
		id: "appearance.theme",
		publicId: "appearance.theme",
		title: "设置外观",
		summary: "对应设置 → 外观：切换显示模式、主题风格、鼠标指针，以及界面语言（zh/en）。",
		description:
			'对象参数：{ "type": "set", "mode"?: ..., "themeId"?: ..., "cursorStyle"?: ... } 或 { "type": "set-language", "language": "zh" | "en" }。只读查询请用 appearance.query（help/get）。',
		keywords: [
			"theme",
			"主题",
			"外观",
			"深色",
			"浅色",
			"dark",
			"light",
			"auto",
			"语言",
			"language",
			"cursor",
			"鼠标",
		],
		effect: "write",
		approval: {
			defaultPresentation: "appearance.theme-change",
			presentations: [
				{
					id: "appearance.theme-change",
					title: "外观变更确认",
					description: "使用外观变更专用审批界面。",
				},
				{
					id: "appearance.picker",
					title: "外观选择器",
					description: "使用可交互的外观选择界面。",
				},
				{
					id: "appearance.set-language",
					title: "修改界面语言确认",
					description: "确认界面语言切换。",
				},
			],
			presentationByOperation: {
				set: "appearance.theme-change",
				"set-language": "appearance.set-language",
			},
			alternativePresentationsByOperation: {
				set: ["appearance.picker"],
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (
				input.type === "set" &&
				input.mode === undefined &&
				input.themeId === undefined &&
				input.cursorStyle === undefined &&
				input.approvalUi !== "appearance.picker"
			) {
				throw new PluginAppActionError(
					"APPEARANCE_CHANGE_EMPTY",
					"Appearance change requires mode, themeId, cursorStyle, or the appearance picker.",
				);
			}
			if (input.type !== "set" || input.themeId === undefined) return;
			const ids = ctx.official.appearance.listThemeIds();
			if (ids.includes(input.themeId)) return;
			throwEntityNotFound({
				operation: "set",
				entity: "color theme",
				idField: "themeId",
				id: input.themeId,
				queryAction: "appearance.query",
				queryExample: { type: "help" },
				resultIdPath: "themes[].id",
				availableIds: ids,
				extra: 'You may also call appearance.query with {"type":"get"} for current state.',
			});
		},
		handler: async ({ input }) => {
			if (input.type === "set-language") return ctx.official.appearance.setLanguage(input.language);
			return ctx.official.appearance.set({
				mode: input.mode,
				themeId: input.themeId,
				cursorStyle: input.cursorStyle,
			});
		},
	});
}
