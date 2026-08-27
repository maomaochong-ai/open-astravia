import { describe, expect, it } from "vitest";
import { buildAskPrompt, buildPageActionLinks } from "../lib/page-actions";

const pageUrl = "https://docs.example.test/core/overview/";
const markdownUrl = "/core/overview.md";

describe("buildPageActionLinks", () => {
	it("lists markdown and LLM destinations for the current page", () => {
		const links = buildPageActionLinks({ pageUrl, markdownUrl });

		expect(links.map((link) => link.id)).toEqual(["markdown", "scira", "chatgpt", "claude", "cursor"]);
		expect(links[0]).toMatchObject({ href: markdownUrl, external: false, label: "查看 Markdown" });

		const prompt = buildAskPrompt(pageUrl);
		const byId = Object.fromEntries(links.map((link) => [link.id, link]));

		expect(new URL(byId.scira.href).searchParams.get("q")).toBe(prompt);
		expect(new URL(byId.chatgpt.href).searchParams.get("prompt")).toBe(prompt);
		expect(new URL(byId.chatgpt.href).searchParams.get("hints")).toBe("search");
		expect(new URL(byId.claude.href).searchParams.get("q")).toBe(prompt);
		expect(new URL(byId.cursor.href).searchParams.get("text")).toBe(prompt);
		expect(links.slice(1).every((link) => link.external)).toBe(true);
	});
});
