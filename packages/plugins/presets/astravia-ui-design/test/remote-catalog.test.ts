import { describe, expect, it } from "vitest";
import { parseRemoteCatalog } from "../src/design-systems/remote-catalog";

/** 一条结构完整的远端条目；各用例只覆盖自己关心的字段。 */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		kind: "design-system",
		slug: "linear",
		name: "Linear",
		category: "dev",
		vibe: "dark",
		blurb: "Dark, dense, engineered calm.",
		tagline: { en: "Dark and dense", zh: "暗色高密度" },
		license: "MIT",
		origin: { type: "curated", upstream: "https://example.com/upstream" },
		resources: [
			{ path: "DESIGN.md", role: "spec", encoding: "text", bytes: 30, content: "# Linear\n\n## Atmosphere\nCalm." },
			{ path: "theme.css", role: "theme", encoding: "text", bytes: 40, content: "@theme {\n--color-primary: #5e6ad2;\n}" },
		],
		...overrides,
	};
}

/** 资源地址是相对仓库根的，所以这里传仓库根而不是清单地址。 */
const BASE = "https://cdn.example.com/gh/openvetta/vetta-design-templates@main/";

function catalog(templates: unknown[]): Record<string, unknown> {
	return { schemaVersion: 1, name: "vetta-design-templates", templates };
}

describe("parseRemoteCatalog", () => {
	it("解析合法清单并带出出处与标语", () => {
		const result = parseRemoteCatalog(catalog([entry()]), BASE);
		expect(result?.systems).toHaveLength(1);
		expect(result?.systems[0]).toMatchObject({
			id: "linear",
			name: "Linear",
			vibe: "dark",
			source: "https://example.com/upstream",
			license: "MIT",
			tagline: { en: "Dark and dense", zh: "暗色高密度" },
		});
		expect(result?.rejected).toEqual([]);
	});

	it.each([
		["顶层不是对象", "nope"],
		["schemaVersion 不认识", { schemaVersion: 2, templates: [entry()] }],
		["templates 不是数组", { schemaVersion: 1, templates: {} }],
		["一条都解析不出来", catalog([entry({ vibe: "purple" })])],
		["条目为空", catalog([])],
	])("%s 时返回 null（调用方保持当前列表）", (_label, raw) => {
		expect(parseRemoteCatalog(raw, BASE)).toBeNull();
	});

	it("跳过还不认识的 kind，不影响同一份清单里的设计体系", () => {
		const result = parseRemoteCatalog(
			catalog([{ kind: "remixable", slug: "future", package: "x.vetdz" }, entry()]),
			BASE,
		);
		expect(result?.systems.map((system) => system.id)).toEqual(["linear"]);
		// 未知 kind 是前向兼容而非错误，不该出现在 rejected 里。
		expect(result?.rejected).toEqual([]);
	});

	function withResources(entries: unknown[]): Record<string, unknown> {
		return { resources: entries };
	}

	it.each([
		[
			"spec 自带 frontmatter（会写出两段）",
			withResources([
				{ path: "DESIGN.md", role: "spec", encoding: "text", bytes: 9, content: "---\nsystem: x\n---\n正文" },
				{ path: "theme.css", role: "theme", encoding: "text", bytes: 9, content: "@theme {}" },
			]),
		],
		[
			"theme 不是 @theme 块",
			withResources([
				{ path: "DESIGN.md", role: "spec", encoding: "text", bytes: 4, content: "# ok" },
				{ path: "theme.css", role: "theme", encoding: "text", bytes: 9, content: "body { color: red }" },
			]),
		],
		["缺 spec 角色", withResources([{ path: "theme.css", role: "theme", encoding: "text", bytes: 9, content: "@theme {}" }])],
		["resources 不是数组", { resources: "nope" }],
		["缺 resources", { resources: undefined }],
		["slug 形态非法", { slug: "../escape" }],
		["vibe 不合法", { vibe: "neon" }],
		["缺 blurb", { blurb: "" }],
	])("丢弃不合格条目：%s", (_label, overrides) => {
		const result = parseRemoteCatalog(catalog([entry(), entry({ slug: "bad", ...overrides })]), BASE);
		expect(result?.systems.map((system) => system.id)).toEqual(["linear"]);
		expect(result?.rejected).toHaveLength(1);
	});

	it("同 id 只保留第一条", () => {
		const result = parseRemoteCatalog(catalog([entry(), entry({ name: "Linear Dup" })]), BASE);
		expect(result?.systems).toHaveLength(1);
		expect(result?.systems[0].name).toBe("Linear");
		expect(result?.rejected).toEqual(["linear"]);
	});

	it("超长正文按畸形源丢弃", () => {
		const huge = `# x\n${"a".repeat(64 * 1024)}`;
		const result = parseRemoteCatalog(
			catalog([
				entry(),
				entry({
					slug: "huge",
					resources: [
						{ path: "DESIGN.md", role: "spec", encoding: "text", bytes: huge.length, content: huge },
						{ path: "theme.css", role: "theme", encoding: "text", bytes: 9, content: "@theme {}" },
					],
				}),
			]),
			BASE,
		);
		expect(result?.systems.map((system) => system.id)).toEqual(["linear"]);
	});

	it("没有 tagline 时不编造，留给 i18n 回落", () => {
		const result = parseRemoteCatalog(catalog([entry({ tagline: { en: "only-en" } })]), BASE);
		expect(result?.systems[0].tagline).toBeUndefined();
	});

	it("带上普通参考素材：截图、参考 HTML 都进 resources", () => {
		const result = parseRemoteCatalog(
			catalog([
				entry({
					resources: [
						{ path: "DESIGN.md", role: "spec", encoding: "text", bytes: 4, content: "# ok" },
						{ path: "theme.css", role: "theme", encoding: "text", bytes: 9, content: "@theme {}" },
						{ path: "reference.html", encoding: "text", bytes: 20, content: "<main>hi</main>" },
						{ path: "screenshots/home.webp", encoding: "binary", bytes: 4096, url: "templates/linear/screenshots/home.webp" },
					],
				}),
			]),
			BASE,
		);
		const resources = result?.systems[0].resources ?? [];
		expect(resources.map((resource) => resource.path)).toEqual([
			"DESIGN.md",
			"theme.css",
			"reference.html",
			"screenshots/home.webp",
		]);
		// 二进制的相对地址按清单源拼成绝对地址，客户端才知道去哪下载。
		const binary = resources.find((resource) => resource.path === "screenshots/home.webp");
		expect(binary).toMatchObject({
			encoding: "binary",
			url: "https://cdn.example.com/gh/openvetta/vetta-design-templates@main/templates/linear/screenshots/home.webp",
		});
	});

	it.each([
		["路径穿越", "../../../etc/passwd"],
		["绝对路径", "/etc/passwd"],
		["反斜杠", "screenshots\\home.webp"],
		["当前目录段", "./home.webp"],
	])("丢弃危险的资源路径：%s", (_label, path) => {
		const result = parseRemoteCatalog(
			catalog([
				entry({
					resources: [
						{ path: "DESIGN.md", role: "spec", encoding: "text", bytes: 4, content: "# ok" },
						{ path: "theme.css", role: "theme", encoding: "text", bytes: 9, content: "@theme {}" },
						{ path, encoding: "text", bytes: 4, content: "evil" },
					],
				}),
			]),
			BASE,
		);
		// 条目本身仍可用，只是那一份危险资源被丢掉。
		expect(result?.systems[0].resources.map((resource) => resource.path)).toEqual(["DESIGN.md", "theme.css"]);
	});

	it("二进制资源指向别的 host 时丢弃", () => {
		const result = parseRemoteCatalog(
			catalog([
				entry({
					resources: [
						{ path: "DESIGN.md", role: "spec", encoding: "text", bytes: 4, content: "# ok" },
						{ path: "theme.css", role: "theme", encoding: "text", bytes: 9, content: "@theme {}" },
						{ path: "evil.png", encoding: "binary", bytes: 10, url: "https://evil.example.com/payload.png" },
					],
				}),
			]),
			BASE,
		);
		expect(result?.systems[0].resources.map((resource) => resource.path)).toEqual(["DESIGN.md", "theme.css"]);
	});
});
