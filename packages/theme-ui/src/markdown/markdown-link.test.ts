import { describe, expect, it } from "vitest";
import { resolveMarkdownLinkTarget } from "./markdown-link";

describe("resolveMarkdownLinkTarget", () => {
	it("routes a document reference to the host instead of a navigable href", () => {
		expect(resolveMarkdownLinkTarget("./other.md")).toEqual({ kind: "file", path: "./other.md" });
		expect(resolveMarkdownLinkTarget("../notes/plan.md")).toEqual({ kind: "file", path: "../notes/plan.md" });
		expect(resolveMarkdownLinkTarget("file:///Users/me/doc.md")).toEqual({ kind: "file", path: "/Users/me/doc.md" });
		expect(resolveMarkdownLinkTarget("/Users/me/doc.md")).toEqual({ kind: "file", path: "/Users/me/doc.md" });
	});

	it("lets web and mail links leave through the host", () => {
		expect(resolveMarkdownLinkTarget("https://example.com/a")).toEqual({
			kind: "external",
			url: "https://example.com/a",
		});
		expect(resolveMarkdownLinkTarget("mailto:someone@example.com")).toEqual({
			kind: "external",
			url: "mailto:someone@example.com",
		});
	});

	it("keeps same-document fragments as anchors", () => {
		expect(resolveMarkdownLinkTarget("#install")).toEqual({ kind: "anchor", href: "#install" });
	});

	// The regression this guards: a relative target with no file extension used to render as a
	// live `href`, so clicking it navigated the renderer away and left a blank window.
	it("leaves anything it cannot handle inert, never navigable", () => {
		expect(resolveMarkdownLinkTarget("docs")).toEqual({ kind: "inert" });
		expect(resolveMarkdownLinkTarget("javascript:alert(1)")).toEqual({ kind: "inert" });
		expect(resolveMarkdownLinkTarget("")).toEqual({ kind: "inert" });
		expect(resolveMarkdownLinkTarget(undefined)).toEqual({ kind: "inert" });
	});
});
