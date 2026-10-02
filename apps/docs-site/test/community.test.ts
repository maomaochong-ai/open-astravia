import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommunityGlyph, CommunityInvite } from "../components/community";
import type { DocsLanguage } from "../lib/i18n";
import { baseOptions } from "../lib/layout.shared";
import { site } from "../lib/site";

function communityEntry(language: DocsLanguage) {
	return (baseOptions(language).links ?? []).find(
		(link) => typeof link === "object" && link !== null && "url" in link && link.url === site.communityUrl,
	);
}

describe("community entry", () => {
	it("sends the sidebar link to the invite with per-language copy", () => {
		expect(communityEntry("zh")).toMatchObject({
			url: site.communityUrl,
			text: "QQ 频道",
			label: "QQ 频道",
			external: true,
		});
		expect(communityEntry("en")).toMatchObject({
			url: site.communityUrl,
			text: "QQ Channel",
			label: "QQ Channel",
			external: true,
		});
	});

	it("draws a wordless mark for the sidebar row", () => {
		const html = renderToStaticMarkup(createElement(CommunityGlyph));

		expect(html.startsWith("<svg")).toBe(true);
		expect(html).not.toContain("undefined");
	});

	it("wraps the homepage copy in an external link to the invite", () => {
		for (const copy of ["QQ 频道", "QQ Channel"]) {
			const html = renderToStaticMarkup(createElement(CommunityInvite, null, copy));

			expect(html).toContain(`href="${site.communityUrl}"`);
			expect(html).toContain('target="_blank"');
			expect(html).toContain('rel="noreferrer"');
			expect(html).toContain(copy);
		}
	});
});
