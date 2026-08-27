import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Beats } from "../components/reading";
import { fieldNoteIsAlert, fieldNoteLabel } from "../lib/reading";

describe("fieldNoteLabel", () => {
	it("maps studio labels for each callout tone", () => {
		expect(fieldNoteLabel("info")).toBe("FIELD NOTE");
		expect(fieldNoteLabel("warn")).toBe("WATCH");
		expect(fieldNoteLabel("warning")).toBe("WATCH");
		expect(fieldNoteLabel("error")).toBe("STOP");
		expect(fieldNoteLabel("success")).toBe("LOCKED");
		expect(fieldNoteLabel("idea")).toBe("IDEA");
	});

	it("defaults missing tone to a field note", () => {
		expect(fieldNoteLabel(undefined)).toBe("FIELD NOTE");
	});
});

describe("fieldNoteIsAlert", () => {
	it("treats warn and error as alert notes", () => {
		expect(fieldNoteIsAlert("warn")).toBe(true);
		expect(fieldNoteIsAlert("warning")).toBe(true);
		expect(fieldNoteIsAlert("error")).toBe(true);
		expect(fieldNoteIsAlert("info")).toBe(false);
		expect(fieldNoteIsAlert("success")).toBe(false);
		expect(fieldNoteIsAlert(undefined)).toBe(false);
	});
});

describe("Beats", () => {
	it("wraps the list so article-level ordered-list styles cannot pinch the text column", () => {
		const html = renderToStaticMarkup(
			createElement(Beats, null, createElement("li", null, "一个项目可以有多个会话，它们共享项目目录。")),
		);

		expect(html.startsWith("<ol")).toBe(false);
		expect(html).toContain('class="docs-beats');
		expect(html).toContain("一个项目可以有多个会话，它们共享项目目录。");
	});
});
