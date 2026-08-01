import { describe, expect, it } from "vitest";
import { crossCheckPackage } from "../publish-ability/scripts/validate.mjs";

/**
 * 交叉校验只依赖 inspectPackage 的产出形状，故这里直接给结构体，不必造真包
 * （zip / tar.gz 的解析由 package-inspect.test.mjs 覆盖）。
 */
function pluginPkg(overrides = {}) {
	return {
		root: "",
		pluginManifest: {
			id: "demo",
			version: "1.0.0",
			name: "%plugin.name%",
			description: "%plugin.description%",
			defaultLocale: "zh",
		},
		skillFrontmatter: null,
		vettaJson: null,
		locales: {
			zh: { "plugin.name": "演示", "plugin.description": "中文简介" },
			en: { "plugin.name": "Demo", "plugin.description": "English intro" },
		},
		...overrides,
	};
}

function pluginInput(i18n) {
	return {
		type: "plugin",
		package_path: "/tmp/demo.zip",
		detail: { name: "演示", description: "中文简介", author: "Me", content: "# 演示", i18n },
	};
}

describe("plugin 的 locale 键对齐", () => {
	it("同语言但键不同时报错——服务端存两块、客户端只命中包内那块", () => {
		const { errors } = crossCheckPackage(pluginInput({ "en-US": { content: "# Demo" } }), pluginPkg());

		expect(errors.some((e) => e.includes('把键改成 "en"'))).toBe(true);
	});

	it("键与包内一致时通过", () => {
		const { errors } = crossCheckPackage(pluginInput({ en: { content: "# Demo" } }), pluginPkg());

		expect(errors).toEqual([]);
	});

	it("包里没有的语言可以自由新增", () => {
		const { errors } = crossCheckPackage(pluginInput({ ja: { content: "# デモ" } }), pluginPkg());

		expect(errors).toEqual([]);
	});

	it("默认语言不该出现在 i18n 里", () => {
		const { errors } = crossCheckPackage(pluginInput({ zh: { name: "重复" } }), pluginPkg());

		expect(errors.some((e) => e.includes("默认语言"))).toBe(true);
	});

	it("defaultLocale 缺省按 zh 处理，与服务端一致", () => {
		const pkg = pluginPkg({ pluginManifest: { id: "demo", version: "1.0.0" } });
		const { errors } = crossCheckPackage(pluginInput({ zh: { name: "重复" } }), pkg);

		expect(errors.some((e) => e.includes("默认语言"))).toBe(true);
	});
});

describe("plugin 的包完整性", () => {
	it("没有 plugin.json 直接报错", () => {
		const { errors } = crossCheckPackage(pluginInput({}), pluginPkg({ pluginManifest: null }));

		expect(errors.some((e) => e.includes("找不到 plugin.json"))).toBe(true);
	});

	it("id 含非法字符报错（会拼进对象存储 key）", () => {
		const pkg = pluginPkg({ pluginManifest: { id: "../evil", version: "1.0.0" } });

		expect(crossCheckPackage(pluginInput({}), pkg).errors.some((e) => e.includes("id 非法"))).toBe(true);
	});

	it("payload 的 slug 会被忽略，给出提醒", () => {
		const input = { ...pluginInput({}), slug: "other-name" };

		expect(crossCheckPackage(input, pluginPkg()).warnings.some((w) => w.includes("会被忽略"))).toBe(true);
	});
});

describe("与包内译文的一致性", () => {
	it("手写译文与包内不一致时提醒（市场与插件内 UI 会显示两句话）", () => {
		const { errors, warnings } = crossCheckPackage(pluginInput({ en: { name: "Different" } }), pluginPkg());

		expect(errors).toEqual([]);
		expect(warnings.some((w) => w.includes("不一致"))).toBe(true);
	});

	it("与包内一致时不提醒", () => {
		const { warnings } = crossCheckPackage(pluginInput({ en: { name: "Demo" } }), pluginPkg());

		expect(warnings).toEqual([]);
	});
});

describe("skill / scene", () => {
	function skillPkg(overrides = {}) {
		return {
			root: "",
			pluginManifest: null,
			skillFrontmatter: { name: "my-skill", metadata: { tags: ["a", "b"] } },
			vettaJson: null,
			locales: {},
			...overrides,
		};
	}
	const skillInput = { type: "skill", package_path: "/tmp/s.tar.gz", detail: { name: "S" } };

	it("slug 以 SKILL.md 的 name 为准", () => {
		const { warnings } = crossCheckPackage({ ...skillInput, slug: "other" }, skillPkg());

		expect(warnings.some((w) => w.includes("SKILL.md 的 name"))).toBe(true);
	});

	it("未提供 detail.tags 时说明会用包内 tags", () => {
		const { warnings } = crossCheckPackage(skillInput, skillPkg());

		expect(warnings.some((w) => w.includes("frontmatter 的 tags"))).toBe(true);
	});

	it("没有 SKILL.md 时报错", () => {
		const { errors } = crossCheckPackage(skillInput, skillPkg({ skillFrontmatter: null }));

		expect(errors.some((e) => e.includes("找不到 SKILL.md"))).toBe(true);
	});
});

describe("vetta.json 与 payload.detail", () => {
	it("两者同时存在时提醒包内那份被整体忽略", () => {
		const { warnings } = crossCheckPackage(pluginInput({}), pluginPkg({ vettaJson: { name: "包里的" } }));

		expect(warnings.some((w) => w.includes("vetta.json 被整体忽略"))).toBe(true);
	});
});

describe("读不动的包", () => {
	it("pkg 为 null 时返回空结果，不挡提交", () => {
		expect(crossCheckPackage(pluginInput({}), null)).toEqual({ errors: [], warnings: [] });
	});
});
