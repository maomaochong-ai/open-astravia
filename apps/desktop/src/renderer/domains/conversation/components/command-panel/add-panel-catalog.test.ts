import { describe, expect, it } from "vitest";
import type { AddPanelEntry } from "./add-panel-catalog";
import {
	ADD_PANEL_CATEGORY_ORDER,
	buildAddPanelCatalog,
	buildAddPanelRows,
	buildFavoritesSections,
	flattenAddPanelSections,
	searchAddPanelSections,
	sectionOf,
} from "./add-panel-catalog";

const skill = (name: string, source: string) => ({
	name,
	description: `${name} 说明`,
	source,
	type: "skill" as const,
});

const baseInput = {
	files: [{ id: "addFile", label: "添加文件", icon: "icon-[solar--paperclip-linear]" }],
	skills: [
		skill("code-review", "builtin"),
		skill("weekly", "user"),
		skill("lark-doc", "plugin"),
		skill("figma-ui", "market"),
		skill("repo-rule", "project"),
	],
	connectors: [{ name: "feishu", label: "飞书", iconUrl: "https://example.test/feishu.png" }],
	plugins: [{ id: "lark", label: "飞书套件" }],
	apps: [{ id: "board", label: "灵感看板", status: "published" as const }],
};

const entriesOf = (sections: ReturnType<typeof buildAddPanelCatalog>, category: string): AddPanelEntry[] =>
	flattenAddPanelSections(sections.filter((section) => section.category === category));

describe("buildAddPanelCatalog", () => {
	it("五个分类按固定顺序返回，空分类也保留轨道位置", () => {
		const sections = buildAddPanelCatalog({});
		expect(sections.map((section) => section.category)).toEqual([...ADD_PANEL_CATEGORY_ORDER]);
		expect(sections.every((section) => section.groups.length === 0)).toBe(true);
	});

	it("技能按来源分组；未知来源单独归「其他」，不冒充「我的」", () => {
		const sections = buildAddPanelCatalog({
			skills: [skill("code-review", "builtin"), skill("weekly", "user"), skill("mystery", "unknown-source")],
		});
		const groups = sectionOf(sections, "skills")?.groups ?? [];
		expect(groups.map((group) => group.id)).toEqual(["builtin", "mine", "other"]);
		expect(groups[1]?.entries.map((entry) => entry.label)).toEqual(["weekly"]);
		expect(groups[2]?.entries.map((entry) => entry.label)).toEqual(["mystery"]);
	});

	it("市场安装（source=market）与自定义安装（source=custom）各自归位", () => {
		const sections = buildAddPanelCatalog({
			skills: [skill("xlsx", "market"), skill("my-own", "custom")],
		});
		const groups = sectionOf(sections, "skills")?.groups ?? [];
		// 回归：市场装的技能曾被算进「我的」，因为主进程把扫描器的目录类型当成了来源。
		expect(groups.map((group) => group.id)).toEqual(["market", "mine"]);
	});

	it("能力市场新来源只要 source 有映射就归到位，不需要改面板代码", () => {
		const sections = buildAddPanelCatalog({ skills: [skill("x", "plugin"), skill("figma-ui", "market")] });
		const groups = sectionOf(sections, "skills")?.groups ?? [];
		// 分组顺序跟随条目出现顺序，但每个来源都落到自己的组里。
		expect(groups.map((group) => group.id)).toEqual(["plugin", "market"]);
	});

	it("文件动作不参与搜索，其余分类参与", () => {
		const sections = buildAddPanelCatalog(baseInput);
		expect(entriesOf(sections, "files")[0]?.searchable).toBe(false);
		expect(entriesOf(sections, "skills").every((entry) => entry.searchable)).toBe(true);
		expect(entriesOf(sections, "connectors")[0]?.searchable).toBe(true);
	});

	it("条目键全局唯一：分类前缀加条目 id", () => {
		const sections = buildAddPanelCatalog(baseInput);
		const keys = flattenAddPanelSections(sections).map((entry) => entry.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain("skills:skill:code-review");
		expect(keys).toContain("connectors:feishu");
	});

	it("优先用结构化 provenance 归类，source 字符串只是回退", () => {
		const sections = buildAddPanelCatalog({
			skills: [
				// source 说 market，provenance 说是插件提供 → 以 provenance 为准
				{
					...skill("from-plugin", "market"),
					provenance: { kind: "provided", providerType: "plugin", providerId: "lark" },
				},
				// 原生目录、项目级 scope → 项目
				{ ...skill("repo-rule", "builtin"), provenance: { kind: "native", scope: "project" } },
				// 原生目录、用户级 scope → 我的
				{ ...skill("mine", "builtin"), provenance: { kind: "native", scope: "user" } },
				// 内置提供方 → 内置
				{ ...skill("builtin-one", "market"), provenance: { kind: "builtin", providerId: "preset" } },
			],
		});
		const groups = sectionOf(sections, "skills")?.groups ?? [];
		// 分组顺序 = 条目首次出现的顺序（面板不重排，避免两次打开之间换组）。
		expect(groups.map((group) => group.id)).toEqual(["plugin", "project", "mine", "builtin"]);
	});

	it("技能图标走调用方解析，缺省时留空", () => {
		const sections = buildAddPanelCatalog({
			skills: [skill("code-review", "builtin")],
			resolveSkillIcon: (candidate) => `icon-for-${candidate.name}`,
		});
		expect(entriesOf(sections, "skills")[0]?.icon).toBe("icon-for-code-review");
	});
});

describe("searchAddPanelSections", () => {
	const sections = buildAddPanelCatalog(baseInput);

	it("跨分类命中，按分类顺序分组", () => {
		const result = searchAddPanelSections(sections, "飞书");
		expect(result.map((section) => section.category)).toEqual(["connectors", "plugins"]);
	});

	it("文件动作不出现在搜索结果里", () => {
		const result = searchAddPanelSections(sections, "添加");
		expect(result).toHaveLength(0);
	});

	it("命中描述也算命中", () => {
		const result = searchAddPanelSections(sections, "说明");
		expect(result.map((section) => section.category)).toEqual(["skills"]);
	});

	it("空搜索词返回原目录", () => {
		expect(searchAddPanelSections(sections, "   ")).toEqual(sections);
	});
});

describe("buildFavoritesSections", () => {
	const sections = buildAddPanelCatalog(baseInput);

	it("跨分类按分类顺序重新分组，丢掉目录里已不存在的键", () => {
		const favorites = ["plugins:lark", "skills:skill:weekly", "skills:gone"];
		const result = buildFavoritesSections(sections, favorites);
		expect(result.map((section) => section.category)).toEqual(["skills", "plugins"]);
		expect(flattenAddPanelSections(result).map((entry) => entry.key)).toEqual([
			"skills:skill:weekly",
			"plugins:lark",
		]);
	});

	it("没有收藏时返回空数组（由视图渲染空态）", () => {
		expect(buildFavoritesSections(sections, [])).toEqual([]);
	});
});

describe("buildAddPanelRows", () => {
	const sections = buildAddPanelCatalog(baseInput);
	const labels = { categoryLabel: (category: string) => category, groupLabel: (key: string) => key };

	it("分类视图：来源多于一个才出分组头，空分类不产生行", () => {
		const skillsOnly = sections.filter((section) => section.category === "skills");
		const rows = buildAddPanelRows(skillsOnly, { searching: false, ...labels });
		expect(rows.filter((row) => row.kind === "header").length).toBeGreaterThan(0);
		expect(rows.filter((row) => row.kind === "entry")).toHaveLength(5);
	});

	it("单个来源分组时不出分组头", () => {
		const single = buildAddPanelCatalog({ skills: [skill("code-review", "builtin")] }).filter(
			(section) => section.category === "skills",
		);
		const rows = buildAddPanelRows(single, { searching: false, ...labels });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("entry");
	});

	it("搜索态按分类分组：标题是分类名", () => {
		const rows = buildAddPanelRows(sections, { searching: true, ...labels });
		const headers = rows
			.filter((row) => row.kind === "header")
			.map((row) => (row.kind === "header" ? row.label : ""));
		expect(headers).toEqual(["files", "skills", "connectors", "plugins", "apps"]);
	});
});
