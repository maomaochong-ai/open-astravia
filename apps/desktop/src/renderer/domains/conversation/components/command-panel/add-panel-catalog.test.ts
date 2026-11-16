import { describe, expect, it } from "vitest";
import {
	ADD_PANEL_CATEGORY_ORDER,
	type AddPanelEntry,
	buildAddPanelCatalog,
	buildAddPanelRows,
	buildFavoritesSections,
	flattenAddPanelSections,
	searchAddPanelSections,
	sectionOf,
	splitIcon,
} from "./add-panel-catalog";

/** 构造一个已投影好的条目（分类模块只接受这种输入，见 `AddPanelCatalogInput` 注释）。 */
function entry(
	category: AddPanelEntry["category"],
	id: string,
	label: string,
	overrides: Partial<AddPanelEntry> = {},
): AddPanelEntry {
	return {
		category,
		id,
		key: `${category}:${id}`,
		label,
		groupId: category === "plugin" ? "installed" : "mine",
		searchable: true,
		fallbackIcon: "icon-[solar--magic-stick-3-linear]",
		...overrides,
	};
}

const ENTRIES: AddPanelEntry[] = [
	entry("skill", "skill:code-review", "代码审阅", { groupId: "builtin" }),
	entry("skill", "skill:weekly", "周报生成"),
	entry("skill", "skill:xlsx", "Spreadsheet Toolkit", { groupId: "market" }),
	entry("mcp", "mcp:feishu", "飞书", { groupId: "connected" }),
	entry("plugin", "plugin:lark", "飞书套件"),
	entry("plugin", "plugin:system", "系统插件", { groupId: "builtin" }),
];

const catalog = (entries: readonly AddPanelEntry[] = ENTRIES) => buildAddPanelCatalog({ entries });

describe("buildAddPanelCatalog", () => {
	it("五个分类按固定顺序返回，空分类也保留轨道位置", () => {
		const sections = buildAddPanelCatalog({});
		expect(sections.map((section) => section.category)).toEqual([...ADD_PANEL_CATEGORY_ORDER]);
		expect(sections.every((section) => section.groups.length === 0)).toBe(true);
	});

	it("条目只按分类落位，分类模块不重排、不再推断来源", () => {
		const sections = catalog();
		expect(sectionOf(sections, "skill")?.groups.map((group) => group.id)).toEqual(["builtin", "mine", "market"]);
		expect(sectionOf(sections, "mcp")?.groups.map((group) => group.id)).toEqual(["connected"]);
		expect(sectionOf(sections, "bundle")).toBeDefined();
		expect(sectionOf(sections, "bundle")?.groups).toHaveLength(0);
	});

	it("分组标题按 groupId 解析：同一分类里的「内置」与「已安装」不会都标成已安装", () => {
		const plugins = sectionOf(catalog(), "plugin")?.groups ?? [];
		expect(plugins.map((group) => group.titleKey)).toEqual([
			"slashPanel.groups.installed",
			"slashPanel.groups.builtin",
		]);
	});

	it("未知分组落到该分类的默认标题", () => {
		const sections = buildAddPanelCatalog({ entries: [entry("skill", "s", "x", { groupId: "who-knows" })] });
		expect(sectionOf(sections, "skill")?.groups[0]?.titleKey).toBe("slashPanel.groups.other");
	});
});

describe("splitIcon", () => {
	it("区分图片 URL 与 iconify 名称", () => {
		expect(splitIcon("astravia-file://local/a.png")).toEqual({ iconUrl: "astravia-file://local/a.png" });
		expect(splitIcon("https://x/y.svg")).toEqual({ iconUrl: "https://x/y.svg" });
		expect(splitIcon("./skills/a.png")).toEqual({ iconUrl: "./skills/a.png" });
		// `solar:` 是 iconify **名称**，不是 URL——当成 URL 塞进 <img> 会落成灰块。
		expect(splitIcon("solar:magic-stick-3-bold")).toEqual({ icon: "solar:magic-stick-3-bold" });
		expect(splitIcon("icon-[solar--x]")).toEqual({ icon: "icon-[solar--x]" });
		expect(splitIcon(undefined)).toEqual({});
	});
});

describe("searchAddPanelSections", () => {
	it("跨分类命中，按分类顺序分组", () => {
		const result = searchAddPanelSections(catalog(), "飞书");
		expect(result.map((section) => section.category)).toEqual(["mcp", "plugin"]);
	});

	it("空搜索词返回原目录", () => {
		const sections = catalog();
		expect(searchAddPanelSections(sections, "   ")).toEqual(sections);
	});
});

describe("buildFavoritesSections", () => {
	it("跨分类按分类顺序重新分组，丢掉目录里已不存在的键", () => {
		const result = buildFavoritesSections(catalog(), ["plugin:plugin:lark", "skill:skill:weekly", "skill:gone"]);
		expect(result.map((section) => section.category)).toEqual(["skill", "plugin"]);
		expect(flattenAddPanelSections(result).map((item) => item.key)).toEqual([
			"skill:skill:weekly",
			"plugin:plugin:lark",
		]);
	});

	it("没有收藏时返回空数组（由视图渲染空态）", () => {
		expect(buildFavoritesSections(catalog(), [])).toEqual([]);
	});
});

describe("buildAddPanelRows", () => {
	const labels = { categoryLabel: (category: string) => category, groupLabel: (key: string) => key };

	it("分类视图：来源多于一个才出分组头", () => {
		const skills = catalog().filter((section) => section.category === "skill");
		const rows = buildAddPanelRows(skills, { searching: false, ...labels });
		expect(rows.filter((row) => row.kind === "header")).toHaveLength(3);
		expect(rows.filter((row) => row.kind === "entry")).toHaveLength(3);
	});

	it("单个来源分组时不出分组头", () => {
		const sections = buildAddPanelCatalog({ entries: [entry("skill", "only", "唯一", { groupId: "builtin" })] });
		const rows = buildAddPanelRows(
			sections.filter((section) => section.category === "skill"),
			{
				searching: false,
				...labels,
			},
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("entry");
	});

	it("搜索 / 全部视图按分类分组：标题是分类名", () => {
		const rows = buildAddPanelRows(catalog(), { searching: true, ...labels });
		const headers = rows
			.filter((row) => row.kind === "header")
			.map((row) => (row.kind === "header" ? row.label : ""));
		expect(headers).toEqual(["skill", "mcp", "plugin", "bundle"]);
	});
});
