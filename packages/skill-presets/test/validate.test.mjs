import { describe, expect, it } from "vitest";
import { validateUploadInput } from "../publish-ability/scripts/validate.mjs";

/** 一份能通过校验的最小 mcp 提交，各用例在它之上改一处。 */
function baseMcpInput(overrides = {}) {
	return {
		type: "mcp",
		slug: "my-server",
		mcp_config: { command: "npx", args: ["-y", "x"] },
		detail: {
			name: "My Server",
			description: "一句话简介",
			author: "Me",
			content: "# My Server\n\n正文",
		},
		...overrides,
	};
}

const alwaysExists = { packageExists: () => true };

describe("type 校验", () => {
	it("type 非法时只报 type，不继续产出误导性报错", () => {
		const errors = validateUploadInput({ type: "widget", detail: {} });

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("type 必填");
	});

	it("缺 type 也走同一条路径", () => {
		expect(validateUploadInput({})).toHaveLength(1);
	});
});

describe("detail 必填项", () => {
	it("四个必填字段缺失时一次列全", () => {
		// 这条正是本地校验存在的理由：服务端只会回第一个错，来回试探要四轮
		const errors = validateUploadInput({ type: "mcp", slug: "s", mcp_config: { a: 1 }, detail: {} });

		expect(errors.some((e) => e.includes("detail.name"))).toBe(true);
		expect(errors.some((e) => e.includes("detail.description"))).toBe(true);
		expect(errors.some((e) => e.includes("detail.author"))).toBe(true);
		expect(errors.some((e) => e.includes("detail.content"))).toBe(true);
	});

	it("detail 整体缺失", () => {
		const errors = validateUploadInput({ type: "mcp", slug: "s", mcp_config: { a: 1 } });

		expect(errors.some((e) => e.includes("detail 必填"))).toBe(true);
	});

	it("空白字符串不算填了", () => {
		const errors = validateUploadInput(baseMcpInput({ detail: { name: "   ", description: "d", author: "a", content: "c" } }));

		expect(errors.some((e) => e.includes("detail.name"))).toBe(true);
	});

	it("完整的 mcp 提交无错", () => {
		expect(validateUploadInput(baseMcpInput())).toEqual([]);
	});
});

describe("icon 三态", () => {
	it.each([
		["", true],
		["   ", true],
		["solar:magic-stick-3-bold", true],
		["https://a.com/i.png", true],
		["http://a.com/i.png", true],
		["mdi:home", false],
		["./local.png", false],
	])("icon %s → 合法 %s", (icon, valid) => {
		const errors = validateUploadInput(baseMcpInput({ detail: { ...baseMcpInput().detail, icon } }));

		expect(errors.some((e) => e.includes("detail.icon"))).toBe(!valid);
	});
});

describe("showcases", () => {
	function withShowcase(showcase) {
		return validateUploadInput(baseMcpInput({ detail: { ...baseMcpInput().detail, showcases: [showcase] } }));
	}

	it("模板必须在白名单内", () => {
		expect(withShowcase({ template: "carousel", user_prompt: "u", assistant_reply: "a" }).some((e) =>
			e.includes("template 非法"),
		)).toBe(true);
	});

	it("prompt 与 reply 必填", () => {
		const errors = withShowcase({ template: "chat-thread" });

		expect(errors.some((e) => e.includes("user_prompt 必填"))).toBe(true);
		expect(errors.some((e) => e.includes("assistant_reply 必填"))).toBe(true);
	});

	it("canvas 仅 chat-over-canvas 可用", () => {
		const errors = withShowcase({ template: "chat-thread", user_prompt: "u", assistant_reply: "a", canvas: "design" });

		expect(errors.some((e) => e.includes("canvas 仅 chat-over-canvas"))).toBe(true);
	});

	it("canvas 母题必须在白名单内", () => {
		const errors = withShowcase({
			template: "chat-over-canvas",
			user_prompt: "u",
			assistant_reply: "a",
			canvas: "video",
		});

		expect(errors.some((e) => e.includes("canvas 非法"))).toBe(true);
	});

	it("brand_icon_url 必须是绝对 URL", () => {
		const errors = withShowcase({
			template: "chat-thread",
			user_prompt: "u",
			assistant_reply: "a",
			brand_icon_url: "/local.png",
		});

		expect(errors.some((e) => e.includes("brand_icon_url"))).toBe(true);
	});

	it("合法 showcase 无错", () => {
		expect(
			withShowcase({ template: "chat-over-canvas", user_prompt: "u", assistant_reply: "a", canvas: "design" }),
		).toEqual([]);
	});
});

describe("meta", () => {
	function withMeta(entry) {
		return validateUploadInput(baseMcpInput({ detail: { ...baseMcpInput().detail, meta: [entry] } }));
	}

	it("预置键必须在白名单内", () => {
		expect(withMeta({ key: "twitter", value: "x" }).some((e) => e.includes("key 非法"))).toBe(true);
	});

	it("没有 key 时必须有 label", () => {
		expect(withMeta({ value: "x" }).some((e) => e.includes("需要 key"))).toBe(true);
	});

	it("value 必填", () => {
		expect(withMeta({ key: "homepage" }).some((e) => e.includes("value 必填"))).toBe(true);
	});

	it("自定义 label 条目合法", () => {
		expect(withMeta({ label: "作者主页", value: "https://a.com" })).toEqual([]);
	});
});

describe("有产物形态", () => {
	it("缺 package_path 报错", () => {
		const errors = validateUploadInput({ type: "skill", detail: baseMcpInput().detail }, alwaysExists);

		expect(errors.some((e) => e.includes("package_path"))).toBe(true);
	});

	it("后缀白名单", () => {
		const errors = validateUploadInput(
			{ type: "skill", package_path: "/tmp/a.rar", detail: baseMcpInput().detail },
			alwaysExists,
		);

		expect(errors.some((e) => e.includes("后缀不支持"))).toBe(true);
	});

	it("plugin 必须是 zip", () => {
		// plugin 靠包内 plugin.json 定 slug 与版本，tar.gz 走不通同一条解析路径
		const errors = validateUploadInput(
			{ type: "plugin", package_path: "/tmp/a.tar.gz", detail: baseMcpInput().detail },
			alwaysExists,
		);

		expect(errors.some((e) => e.includes("必须是 .zip"))).toBe(true);
	});

	it("文件不存在时报错", () => {
		const errors = validateUploadInput(
			{ type: "skill", package_path: "/tmp/missing.zip", detail: baseMcpInput().detail },
			{ packageExists: () => false },
		);

		expect(errors.some((e) => e.includes("不存在"))).toBe(true);
	});

	it("有产物形态不要求 slug", () => {
		// slug 来自包内 manifest，要求作者再填一遍只会制造不一致
		const errors = validateUploadInput(
			{ type: "skill", package_path: "/tmp/a.zip", detail: baseMcpInput().detail },
			alwaysExists,
		);

		expect(errors).toEqual([]);
	});
});

describe("无产物形态的 slug", () => {
	it("mcp 缺 slug 报错", () => {
		const errors = validateUploadInput(baseMcpInput({ slug: undefined }));

		expect(errors.some((e) => e.includes("必须提供 slug"))).toBe(true);
	});

	it("slug 字符白名单（防对象存储 key 路径注入）", () => {
		const errors = validateUploadInput(baseMcpInput({ slug: "../etc/passwd" }));

		expect(errors.some((e) => e.includes("slug 含非法字符"))).toBe(true);
	});

	it("version 同样受白名单约束", () => {
		const errors = validateUploadInput(baseMcpInput({ version: "1.0/../x" }));

		expect(errors.some((e) => e.includes("version 含非法字符"))).toBe(true);
	});
});

describe("mcp_config", () => {
	it("缺失或空对象都报错", () => {
		expect(validateUploadInput(baseMcpInput({ mcp_config: undefined })).some((e) => e.includes("mcp_config"))).toBe(
			true,
		);
		expect(validateUploadInput(baseMcpInput({ mcp_config: {} })).some((e) => e.includes("mcp_config"))).toBe(true);
	});
});

describe("bundle members", () => {
	function withMembers(members) {
		return validateUploadInput({
			type: "bundle",
			slug: "my-bundle",
			members,
			detail: baseMcpInput().detail,
		});
	}

	it("members 必填且非空", () => {
		expect(withMembers(undefined).some((e) => e.includes("members"))).toBe(true);
		expect(withMembers([]).some((e) => e.includes("members"))).toBe(true);
	});

	it("不能嵌套 bundle", () => {
		expect(withMembers([{ type: "bundle", slug: "x" }]).some((e) => e.includes("不能嵌套"))).toBe(true);
	});

	it("成员去重", () => {
		const errors = withMembers([
			{ type: "skill", slug: "a" },
			{ type: "skill", slug: "a" },
		]);

		expect(errors.some((e) => e.includes("成员重复"))).toBe(true);
	});

	it("inline 仅 mcp 成员允许", () => {
		// 带产物的成员必须引用已上架条目，否则安装时无从取包
		const errors = withMembers([{ type: "skill", slug: "a", inline: { x: 1 } }]);

		expect(errors.some((e) => e.includes("inline 仅 mcp"))).toBe(true);
	});

	it("合法 bundle 无错", () => {
		expect(
			withMembers([
				{ type: "skill", slug: "a" },
				{ type: "mcp", slug: "b", inline: { command: "x" } },
			]),
		).toEqual([]);
	});
});

describe("detail 字段白名单", () => {
	it("顶层写错键名报错——服务端只会静默丢弃它", () => {
		const errors = validateUploadInput(baseMcpInput({ detail: { ...baseMcpInput().detail, long_description: "x" } }));

		expect(errors.some((e) => e.includes("detail.long_description 不是合法字段"))).toBe(true);
	});

	it("译文块写错键名同样报错", () => {
		const errors = validateUploadInput(
			baseMcpInput({ detail: { ...baseMcpInput().detail, i18n: { en: { title: "x" } } } }),
		);

		expect(errors.some((e) => e.includes("detail.i18n.en.title 不是合法字段"))).toBe(true);
	});

	it("译文块不接受 author/license/icon（这些不按语言区分）", () => {
		const errors = validateUploadInput(
			baseMcpInput({ detail: { ...baseMcpInput().detail, i18n: { en: { author: "Me" } } } }),
		);

		expect(errors.some((e) => e.includes("detail.i18n.en.author"))).toBe(true);
	});

	it("合法字段全集不报错", () => {
		const errors = validateUploadInput(
			baseMcpInput({
				detail: {
					...baseMcpInput().detail,
					license: "MIT",
					icon: "",
					tags: ["a"],
					i18n: { en: { name: "N", description: "D", tags: ["a"], content: "C" } },
				},
			}),
		);

		expect(errors).toEqual([]);
	});
});

describe("i18n 的 locale 键", () => {
	function withLocale(locale) {
		return validateUploadInput(
			baseMcpInput({ detail: { ...baseMcpInput().detail, i18n: { [locale]: { name: "N" } } } }),
		);
	}

	it("带地区后缀的键报错并给出改法", () => {
		// 客户端界面语言只有基语言；en-US 在包内也有 en 译文时会被整块忽略
		const errors = withLocale("en-US");

		expect(errors.some((e) => e.includes('改成 "en"'))).toBe(true);
	});

	it("下划线形式同样拦下", () => {
		expect(withLocale("zh_CN").some((e) => e.includes("地区后缀"))).toBe(true);
	});

	it("大写键报错", () => {
		expect(withLocale("EN").some((e) => e.includes("必须小写"))).toBe(true);
	});

	it("基语言键通过", () => {
		expect(withLocale("ja")).toEqual([]);
	});
});

describe("plugin 的 version", () => {
	it("传了就报错——服务端恒取 plugin.json 的版本", () => {
		const errors = validateUploadInput(
			{ type: "plugin", package_path: "/tmp/a.zip", version: "2.0.0", detail: baseMcpInput().detail },
			alwaysExists,
		);

		expect(errors.some((e) => e.includes("plugin 的版本以包内 plugin.json"))).toBe(true);
	});

	it("skill 传 version 正常", () => {
		const errors = validateUploadInput(
			{ type: "skill", package_path: "/tmp/a.zip", version: "2.0.0", detail: baseMcpInput().detail },
			alwaysExists,
		);

		expect(errors).toEqual([]);
	});
});
