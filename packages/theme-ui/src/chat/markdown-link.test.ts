import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import {
	chatUrlTransform,
	classifyMarkdownLink,
	fileUrlToPath,
	normalizeLocalFileLinksInMarkdown,
} from "./markdown-link";

describe("fileUrlToPath", () => {
	test("posix file URL", () => {
		expect(fileUrlToPath("file:///home/u/a.ts")).toBe("/home/u/a.ts");
	});

	test("windows drive file URL", () => {
		expect(fileUrlToPath("file:///C:/Users/u/a.ts")).toBe("C:/Users/u/a.ts");
	});

	test("windows drive with encoded spaces", () => {
		expect(fileUrlToPath("file:///C:/Users/u/My%20Docs/a.ts")).toBe("C:/Users/u/My Docs/a.ts");
	});
});

describe("chatUrlTransform", () => {
	test("preserves windows drive paths that defaultUrlTransform blanks", () => {
		expect(chatUrlTransform("C:\\Users\\u\\a.html")).toBe("C:\\Users\\u\\a.html");
		expect(chatUrlTransform("C:/Users/u/a.html")).toBe("C:/Users/u/a.html");
		expect(chatUrlTransform("C:%5CUsers%5Cu%5Ca.html")).toBe("C:%5CUsers%5Cu%5Ca.html");
	});

	test("preserves file: URLs", () => {
		expect(chatUrlTransform("file:///C:/Users/u/a.html")).toBe("file:///C:/Users/u/a.html");
		expect(chatUrlTransform("file:///tmp/a.html")).toBe("file:///tmp/a.html");
	});

	test("still blocks javascript:", () => {
		expect(chatUrlTransform("javascript:alert(1)")).toBe("");
	});

	test("keeps https and posix absolute", () => {
		expect(chatUrlTransform("https://example.com/a")).toBe("https://example.com/a");
		expect(chatUrlTransform("/tmp/a.html")).toBe("/tmp/a.html");
	});
});

describe("normalizeLocalFileLinksInMarkdown", () => {
	test("repairs the exact Windows deliverable link emitted with spaces and parentheses", () => {
		const input = "[travel-app.vetd](/C:/Users/admin/Desktop/新建文件夹 (7)/vetta/travel-app.vetd)";
		expect(normalizeLocalFileLinksInMarkdown(input)).toBe(
			"[travel-app.vetd](</C:/Users/admin/Desktop/新建文件夹 (7)/vetta/travel-app.vetd>)",
		);
	});

	test("repairs POSIX absolute paths with spaces using a CommonMark angle-bracket destination", () => {
		const input = "[report.pdf](/home/user/My Reports/report.pdf)";
		expect(normalizeLocalFileLinksInMarkdown(input)).toBe("[report.pdf](</home/user/My Reports/report.pdf>)");
	});

	test("rewrites backslash destinations to forward slashes", () => {
		const input = "[index.html](C:\\Users\\flowerwine\\.vetta\\conversation\\afc54df9\\index.html)";
		const out = normalizeLocalFileLinksInMarkdown(input);
		expect(out).toBe("[index.html](<C:/Users/flowerwine/.vetta/conversation/afc54df9/index.html>)");
	});

	test("rewrites angle-bracket destinations", () => {
		const input = "[a](<C:\\Users\\x\\.vetta\\a.html>)";
		expect(normalizeLocalFileLinksInMarkdown(input)).toBe("[a](<C:/Users/x/.vetta/a.html>)");
	});

	test("standardizes absolute local links and leaves web links alone", () => {
		const input = "[a](C:/Users/x/a.html) and [b](https://x.com) and [c](/tmp/a)";
		expect(normalizeLocalFileLinksInMarkdown(input)).toBe(
			"[a](<C:/Users/x/a.html>) and [b](https://x.com) and [c](</tmp/a>)",
		);
	});

	test("preserves standard markdown link titles", () => {
		const input = "[a](C:/Users/x/a.html \"title\") and [b](/tmp/b.md 'title')";
		expect(normalizeLocalFileLinksInMarkdown(input)).toBe(
			"[a](<C:/Users/x/a.html> \"title\") and [b](</tmp/b.md> 'title')",
		);
	});

	test("does not rewrite examples inside inline or fenced code", () => {
		const inline = "`[a](C:/Users/x/My File.md)`";
		const fenced = "```md\n[a](C:/Users/x/My File.md)\n```";
		expect(normalizeLocalFileLinksInMarkdown(inline)).toBe(inline);
		expect(normalizeLocalFileLinksInMarkdown(fenced)).toBe(fenced);
	});
});

describe("classifyMarkdownLink", () => {
	test("https URL", () => {
		expect(classifyMarkdownLink("https://example.com/a")).toEqual({
			type: "url",
			url: "https://example.com/a",
		});
	});

	test("protocol-relative URL", () => {
		expect(classifyMarkdownLink("//cdn.example.com/x.js")).toEqual({
			type: "url",
			url: "https://cdn.example.com/x.js",
		});
	});

	test("posix absolute path", () => {
		expect(classifyMarkdownLink("/tmp/out.pdf")).toEqual({
			type: "file",
			path: "/tmp/out.pdf",
		});
	});

	test("windows absolute path with backslashes", () => {
		expect(classifyMarkdownLink("C:\\project\\report.pdf")).toEqual({
			type: "file",
			path: "C:/project/report.pdf",
		});
	});

	test("windows absolute path with slashes", () => {
		expect(classifyMarkdownLink("C:/project/report.pdf")).toEqual({
			type: "file",
			path: "C:/project/report.pdf",
		});
	});

	test("rehype percent-encoded windows path", () => {
		expect(classifyMarkdownLink("C:%5CUsers%5Cflowerwine%5C.vetta%5Cconversation%5Cafc54df9%5Cindex.html")).toEqual({
			type: "file",
			path: "C:/Users/flowerwine/.vetta/conversation/afc54df9/index.html",
		});
	});

	test("file URL windows", () => {
		expect(classifyMarkdownLink("file:///D:/work/a.md")).toEqual({
			type: "file",
			path: "D:/work/a.md",
		});
	});

	test("relative with ./", () => {
		expect(classifyMarkdownLink("./src/index.ts")).toEqual({
			type: "file",
			path: "./src/index.ts",
		});
	});

	test("relative with path segment", () => {
		expect(classifyMarkdownLink("src/index.ts")).toEqual({
			type: "file",
			path: "src/index.ts",
		});
	});

	test("bare filename with known extension", () => {
		expect(classifyMarkdownLink("readme.md")).toEqual({
			type: "file",
			path: "readme.md",
		});
	});

	test("does not treat bare domain as file", () => {
		expect(classifyMarkdownLink("www.example.com")).toEqual({
			type: "other",
			href: "www.example.com",
		});
	});

	test("fragment and mailto are other", () => {
		expect(classifyMarkdownLink("#section")).toEqual({ type: "other", href: "#section" });
		expect(classifyMarkdownLink("mailto:a@b.com")).toEqual({
			type: "other",
			href: "mailto:a@b.com",
		});
	});

	test("empty href after urlTransform blank is other", () => {
		expect(classifyMarkdownLink("")).toEqual({ type: "other", href: "" });
	});
});

describe("end-to-end: remark parse + urlTransform for user example", () => {
	test("forward-slash Windows path with spaces and parentheses survives as a file link", () => {
		const r = createRequire(import.meta.url);
		const rmPath = r.resolve("react-markdown");
		const r2 = createRequire(rmPath);
		const { unified } = r2("unified");
		const remarkParse = r2("remark-parse").default || r2("remark-parse");
		const remarkRehype = r2("remark-rehype").default || r2("remark-rehype");
		const { visit } = r2("unist-util-visit");

		const raw = "[travel-app.vetd](/C:/Users/admin/Desktop/新建文件夹 (7)/vetta/travel-app.vetd)";
		const source = normalizeLocalFileLinksInMarkdown(raw);
		const processor = unified().use(remarkParse).use(remarkRehype);
		const tree = processor.runSync(processor.parse(source));
		let href: string | undefined;
		visit(tree, "element", (node: { tagName?: string; properties?: { href?: string } }) => {
			if (node.tagName === "a") href = node.properties?.href;
		});

		expect(href).toBe(
			"/C:/Users/admin/Desktop/%E6%96%B0%E5%BB%BA%E6%96%87%E4%BB%B6%E5%A4%B9%20(7)/vetta/travel-app.vetd",
		);
		expect(classifyMarkdownLink(chatUrlTransform(href ?? ""))).toEqual({
			type: "file",
			path: "/C:/Users/admin/Desktop/新建文件夹 (7)/vetta/travel-app.vetd",
		});
	});

	test("backslash path survives and classifies as file with .vetta intact", () => {
		const r = createRequire(import.meta.url);
		const rmPath = r.resolve("react-markdown");
		const r2 = createRequire(rmPath);
		const { unified } = r2("unified");
		const remarkParse = r2("remark-parse").default || r2("remark-parse");
		const remarkRehype = r2("remark-rehype").default || r2("remark-rehype");
		const { visit } = r2("unist-util-visit");

		const BS = "\\";
		const raw = `[index.html](C:${BS}Users${BS}flowerwine${BS}.vetta${BS}conversation${BS}afc54df9-bcf0-4ec0-9632-0c2a4dde88c7${BS}index.html)`;
		const source = normalizeLocalFileLinksInMarkdown(raw);
		expect(source).toContain("flowerwine/.vetta/");

		const tree = unified().use(remarkParse).use(remarkRehype).runSync(unified().use(remarkParse).parse(source));
		let href: string | undefined;
		visit(tree, "element", (node: { tagName?: string; properties?: { href?: string } }) => {
			if (node.tagName === "a") href = node.properties?.href;
		});
		expect(href).toBeDefined();
		const transformed = chatUrlTransform(href ?? "");
		expect(transformed).not.toBe("");
		expect(classifyMarkdownLink(transformed)).toEqual({
			type: "file",
			path: "C:/Users/flowerwine/.vetta/conversation/afc54df9-bcf0-4ec0-9632-0c2a4dde88c7/index.html",
		});
	});
});
