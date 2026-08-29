import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { docsI18n, getDocsMessages, getI18nProvider, getRequestLanguage, localeConfig, messages } from "../lib/i18n";
import { config as proxyConfig } from "../proxy";

const appRoot = resolve(import.meta.dirname, "..");
const docsRoot = resolve(appRoot, "content/docs");
const channelsSource = resolve(import.meta.dirname, "../../desktop/src/main/im-host/channels.ts");

function readDocsFile(path: string): string {
	return readFileSync(resolve(docsRoot, path), "utf8");
}

function listContentFiles(directory = docsRoot): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) return listContentFiles(path);
		return /\.(?:mdx?|md)$/u.test(entry.name) ? [path] : [];
	});
}

function listLocalePages(language: (typeof docsI18n.languages)[number]): string[] {
	const directory = language === docsI18n.defaultLanguage ? docsRoot : resolve(docsRoot, language);

	function walk(current: string, prefix = ""): string[] {
		return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
			if (
				language === docsI18n.defaultLanguage &&
				docsI18n.languages.includes(entry.name as (typeof docsI18n.languages)[number])
			)
				return [];
			const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) return walk(resolve(current, entry.name), relativePath);
			if (!/\.(?:mdx?|md)$/u.test(entry.name)) return [];
			return [relativePath.replace(/\.(?:mdx?|md)$/u, "")];
		});
	}

	return walk(directory);
}

describe("documentation content model", () => {
	it("uses the official hidden-locale mode without language URL prefixes", () => {
		expect(docsI18n).toMatchObject({
			languages: ["zh", "en"],
			defaultLanguage: "zh",
			hideLocale: "always",
			parser: "dir",
			fallbackLanguage: "zh",
		});
		expect(getI18nProvider("zh").locale).toBe("zh");
		expect(getI18nProvider("en").locale).toBe("en");
		expect(localeConfig.en.htmlLang).toBe("en-US");
		expect(proxyConfig.matcher[0]).toContain("images");
	});

	it("keeps application copy in a complete, data-driven locale dictionary", () => {
		const keys = Object.keys(messages.zh).sort();

		for (const language of docsI18n.languages) {
			expect(Object.keys(getDocsMessages(language)).sort(), language).toEqual(keys);
		}
	});

	it("does not reintroduce language-specific English branches", () => {
		const files = [
			"components/brand-mark.tsx",
			"components/home.tsx",
			"components/page-toolbar.tsx",
			"components/reading.tsx",
			"components/studio-banner.tsx",
			"components/toc-actions.tsx",
			"lib/docs-date.ts",
			"lib/layout.shared.tsx",
			"lib/page-actions.ts",
			"lib/seo/metadata.ts",
			"app/llms.txt/route.ts",
			"app/[lang]/(docs)/[[...slug]]/page.tsx",
		];

		for (const file of files) {
			const contents = readFileSync(resolve(appRoot, file), "utf8");
			expect(contents, file).not.toMatch(/(?:language|locale)\s*===\s*["']en["']/u);
		}
	});

	it("keeps English homepage typography free of forced line breaks", () => {
		const englishHome = readDocsFile("en/index.mdx");

		expect(englishHome).toContain("Let your Agent finish work in <span");
		expect(englishHome).not.toContain("Let your Agent <br />");
	});

	it("keeps every referenced public image available", () => {
		const references = new Set<string>();
		const imagePattern =
			/(?:src|href)=["'](?<src>\/images\/[^"']+)["']|!\[[^\]]*\]\((?<markdown>\/images\/[^)\s]+)\)/gu;

		for (const path of listContentFiles()) {
			const contents = readFileSync(path, "utf8");
			for (const match of contents.matchAll(imagePattern)) {
				const reference = match.groups?.src ?? match.groups?.markdown;
				if (reference) references.add(reference);
			}
		}

		for (const reference of references) {
			expect(existsSync(resolve(appRoot, "public", reference.slice(1))), reference).toBe(true);
		}
	});

	it("prefers the saved language and otherwise negotiates the browser language", () => {
		expect(
			getRequestLanguage(
				new Request("https://docs.example.test/", {
					headers: { "Accept-Language": "en-US,en;q=0.9" },
				}),
			),
		).toBe("en");
		expect(
			getRequestLanguage(
				new Request("https://docs.example.test/", {
					headers: { "Accept-Language": "en-US,en;q=0.9", Cookie: "FD_LOCALE=zh" },
				}),
			),
		).toBe("zh");
		expect(
			getRequestLanguage(
				new Request("https://docs.example.test/", {
					headers: { "Accept-Language": "ja-JP,ja;q=0.9" },
				}),
			),
		).toBe("zh");
	});

	it("ships English entry points for the most-used documentation paths", () => {
		const englishPages = [
			"en/index.mdx",
			"en/getting-started/index.mdx",
			"en/getting-started/first-task.mdx",
			"en/core/overview.mdx",
			"en/product/overview.mdx",
			"en/product/models.mdx",
			"en/product/im.mdx",
			"en/product/remote-control.mdx",
			"en/product/settings.mdx",
			"en/plugins/overview.mdx",
			"en/developers/overview.mdx",
			"en/reference/compatibility.mdx",
		];

		for (const path of englishPages) {
			const contents = readDocsFile(path);
			expect(contents, path).toMatch(/^---[\s\S]*?title: [^\n]+/u);
			expect(contents, path).not.toContain('href="/en/');
			expect(contents, path).not.toContain('href="/zh/');
			expect(contents, path).not.toContain("](/en/");
			expect(contents, path).not.toContain("](/zh/");
		}
	});

	it("keeps every supported locale in the official directory parser layout", () => {
		for (const language of docsI18n.languages) {
			const root = language === docsI18n.defaultLanguage ? docsRoot : resolve(docsRoot, language);
			expect(existsSync(root), language).toBe(true);
			expect(existsSync(resolve(root, "meta.json")), `${language}/meta.json`).toBe(true);
			expect(listLocalePages(language), language).toContain("index");
		}
	});

	it("keeps worked examples in the primary navigation", () => {
		const rootMeta = JSON.parse(readDocsFile("meta.json")) as { pages: string[] };
		const examplesMeta = JSON.parse(readDocsFile("examples/meta.json")) as { pages: string[] };

		expect(rootMeta.pages).toContain("examples");
		expect(examplesMeta.pages).toEqual([
			"index",
			"review-and-fix-code",
			"document-to-brief",
			"batch-project-audit",
			"scheduled-project-report",
		]);
	});

	it("gives every worked example a runnable and recoverable structure", () => {
		const examplesMeta = JSON.parse(readDocsFile("examples/meta.json")) as { pages: string[] };

		for (const slug of examplesMeta.pages.filter((page) => page !== "index")) {
			const contents = readDocsFile(`examples/${slug}.mdx`);
			expect(contents, slug).toContain("<Takeaways>");
			expect(contents, slug).toContain("## 起始状态");
			expect(contents, slug).toMatch(/```(?:text)?[\s\S]+```/u);
			expect(contents, slug).toContain("## 预期产物");
			expect(contents, slug).toContain("## 验收结果");
			expect(contents, slug).toContain("<Checklist");
			expect(contents, slug).toContain("## 结果不符合时恢复");
			expect(contents, slug).toContain("<Continue>");
		}
	});

	it("keeps the public IM channel overview aligned with the source registry", () => {
		const source = readFileSync(channelsSource, "utf8");
		const selectorBlock = source.match(/IM_TRANSPORT_SELECTORS = \[(?<selectors>[\s\S]*?)\] as const/u)?.groups
			?.selectors;
		expect(selectorBlock).toBeDefined();

		const selectors = [...(selectorBlock?.matchAll(/"(?<selector>[a-z]+)"/gu) ?? [])].map(
			(match) => match.groups?.selector,
		);
		const displayNames: Record<string, string> = {
			feishu: "飞书",
			wechat: "微信",
			telegram: "Telegram",
			slack: "Slack",
			discord: "Discord",
			signal: "Signal",
			whatsapp: "WhatsApp",
			imessage: "iMessage",
		};
		const overview = readDocsFile("product/im.mdx");

		for (const selector of selectors) {
			expect(selector, "channel selector").toBeDefined();
			expect(displayNames[selector ?? ""], "channel display name").toBeDefined();
			expect(overview).toContain(`| ${displayNames[selector ?? ""]} |`);
		}
	});

	it("keeps newly covered public areas discoverable", () => {
		const rootMeta = JSON.parse(readDocsFile("meta.json")) as { pages: string[] };
		const productMeta = JSON.parse(readDocsFile("product/meta.json")) as { pages: string[] };
		const gettingStartedMeta = JSON.parse(readDocsFile("getting-started/meta.json")) as { pages: string[] };
		const developersMeta = JSON.parse(readDocsFile("developers/meta.json")) as { pages: string[] };

		expect(rootMeta.pages).toEqual(expect.arrayContaining(["getting-started", "product", "developers"]));
		expect(productMeta.pages).toEqual(expect.arrayContaining(["remote-control", "settings"]));
		expect(gettingStartedMeta.pages).toContain("installation-and-updates");
		expect(developersMeta.pages).toContain("sdk-reference");
	});
});
