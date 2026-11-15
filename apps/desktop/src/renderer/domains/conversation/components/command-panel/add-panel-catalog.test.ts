import { describe, expect, it } from "vitest";
import type { AddPanelEntry } from "./add-panel-catalog";
import {
	ADD_PANEL_CATEGORY_ORDER,
	buildAddPanelCatalog,
	buildFavoritesSections,
	computeAddPanelWindow,
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

	it("技能按来源分组，未知来源归到「我的」", () => {
		const sections = buildAddPanelCatalog({
			skills: [skill("code-review", "builtin"), skill("weekly", "user"), skill("mystery", "unknown-source")],
		});
		const groups = sectionOf(sections, "skills")?.groups ?? [];
		expect(groups.map((group) => group.id)).toEqual(["builtin", "mine"]);
		expect(groups[1]?.entries.map((entry) => entry.label)).toEqual(["weekly", "mystery"]);
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

describe("computeAddPanelWindow", () => {
	const entries = Array.from({ length: 100 }, (_, index) => ({
		category: "skills" as const,
		id: `s${index}`,
		key: `skills:s${index}`,
		label: `技能 ${index}`,
		groupId: "builtin",
		searchable: true,
	}));

	it("条目不超过阈值时全量渲染", () => {
		const window = computeAddPanelWindow({
			entries: entries.slice(0, 40),
			rowHeight: 28,
			viewportHeight: 268,
			scrollTop: 0,
		});
		expect(window.entries).toHaveLength(40);
		expect(window.paddingTop).toBe(0);
		expect(window.paddingBottom).toBe(0);
	});

	it("超过阈值时只渲染可视窗口，并用空白占位撑住总高度", () => {
		const window = computeAddPanelWindow({ entries, rowHeight: 28, viewportHeight: 268, scrollTop: 0 });
		expect(window.entries.length).toBeLessThan(100);
		expect(window.paddingTop).toBe(0);
		expect(window.paddingBottom).toBeGreaterThan(0);
		expect(window.entries.length * 28 + window.paddingTop + window.paddingBottom).toBe(100 * 28);
	});

	it("滚到中间时上下都有占位，窗口跟着滚动量移动", () => {
		const window = computeAddPanelWindow({ entries, rowHeight: 28, viewportHeight: 268, scrollTop: 1400 });
		expect(window.paddingTop).toBeGreaterThan(0);
		expect(window.paddingBottom).toBeGreaterThan(0);
		expect(window.entries[0]?.id).not.toBe("s0");
	});
});
