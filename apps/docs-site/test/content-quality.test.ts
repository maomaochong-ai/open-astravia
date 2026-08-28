import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const docsRoot = resolve(import.meta.dirname, "../content/docs");

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
});
