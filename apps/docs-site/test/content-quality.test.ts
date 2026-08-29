import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const docsRoot = resolve(import.meta.dirname, "../content/docs");
const channelsSource = resolve(import.meta.dirname, "../../desktop/src/main/im-host/channels.ts");

function readDocsFile(path: string): string {
	return readFileSync(resolve(docsRoot, path), "utf8");
}

describe("documentation content model", () => {
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
