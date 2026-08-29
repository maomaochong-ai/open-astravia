import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { docsI18n, englishPageDescriptions, englishPageTitles, getRequestLanguage, uiTranslations } from "../lib/i18n";
import { config as proxyConfig } from "../proxy";

const appRoot = resolve(import.meta.dirname, "..");
const docsRoot = resolve(appRoot, "content/docs");
const channelsSource = resolve(import.meta.dirname, "../../desktop/src/main/im-host/channels.ts");

function readDocsFile(path: string): string {
	return readFileSync(resolve(docsRoot, path), "utf8");
}

function listDefaultLanguagePageKeys(directory = docsRoot, prefix = ""): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === "en") return [];
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return listDefaultLanguagePageKeys(resolve(directory, entry.name), relativePath);
		if (!/\.(?:mdx?|md)$/u.test(entry.name)) return [];
		return [relativePath.replace(/\.(?:mdx?|md)$/u, "")];
	});
}

function listContentFiles(directory = docsRoot): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) return listContentFiles(path);
		return /\.(?:mdx?|md)$/u.test(entry.name) ? [path] : [];
	});
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
		expect(uiTranslations.zh["Choose a language"]).toBe("选择语言");
		expect(uiTranslations.en["Choose a language"]).toBe("Choose a language");
		expect(proxyConfig.matcher[0]).toContain("images");
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

	it("keeps every sidebar title and description available in English", () => {
		for (const key of listDefaultLanguagePageKeys()) {
			expect(englishPageTitles[key], key).toBeDefined();
			expect(englishPageDescriptions[key], key).toBeDefined();
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
