import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodePathBoundaryClassifier } from "../../src/coding/index.js";

describe("Node path boundary classifier", () => {
	const root = join(process.cwd(), "path-boundary-fixture");
	const protectedDirectory = join(root, "skills");
	const wikiDirectory = join(root, "knowledge", "wiki");
	const classifier = createNodePathBoundaryClassifier({
		protectedDirectories: [protectedDirectory],
		knowledgeWikiDirectory: wikiDirectory,
	});

	it("classifies directory roots and descendants", () => {
		expect(classifier.isProtectedSkillOrScenePath(protectedDirectory)).toBe(true);
		expect(classifier.isProtectedSkillOrScenePath(join(protectedDirectory, "demo", "SKILL.md"))).toBe(true);
		expect(classifier.isKnowledgeWikiPath(join(wikiDirectory, "page.md"))).toBe(true);
	});

	it("does not classify sibling directories that only share a prefix", () => {
		expect(classifier.isProtectedSkillOrScenePath(`${protectedDirectory}-backup`)).toBe(false);
		expect(classifier.isKnowledgeWikiPath(`${wikiDirectory}-backup`)).toBe(false);
	});
});
