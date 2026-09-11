import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodePathBoundaryClassifier } from "../../src/coding/index.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
	temporaryDirectories.length = 0;
});

function createFixture(): { readonly protectedDirectory: string; readonly wikiDirectory: string } {
	const root = mkdtempSync(join(tmpdir(), "vetta-path-boundary-"));
	temporaryDirectories.push(root);
	const protectedDirectory = join(root, "skills");
	const wikiDirectory = join(root, "knowledge", "wiki");
	mkdirSync(protectedDirectory, { recursive: true });
	mkdirSync(wikiDirectory, { recursive: true });
	return { protectedDirectory, wikiDirectory };
}

function createClassifier(protectedDirectory: string, wikiDirectory: string) {
	return createNodePathBoundaryClassifier({
		readOnlyDirectories: [protectedDirectory],
		managedDirectory: wikiDirectory,
	});
}

describe("Node path boundary classifier", () => {
	it("classifies directory roots and installed entries", () => {
		const { protectedDirectory, wikiDirectory } = createFixture();
		mkdirSync(join(protectedDirectory, "demo"));
		writeFileSync(join(protectedDirectory, "demo", "SKILL.md"), "installed");
		const classifier = createClassifier(protectedDirectory, wikiDirectory);

		expect(classifier.isReadOnlyPath(protectedDirectory)).toBe(true);
		expect(classifier.isReadOnlyPath(join(protectedDirectory, "demo", "SKILL.md"))).toBe(true);
		expect(classifier.isReadOnlyPath(join(protectedDirectory, "demo", "references", "notes.md"))).toBe(true);
		expect(classifier.isManagedPath(join(wikiDirectory, "page.md"))).toBe(true);
	});

	it("does not classify sibling directories that only share a prefix", () => {
		const { protectedDirectory, wikiDirectory } = createFixture();
		const classifier = createClassifier(protectedDirectory, wikiDirectory);

		expect(classifier.isReadOnlyPath(`${protectedDirectory}-backup`)).toBe(false);
		expect(classifier.isManagedPath(`${wikiDirectory}-backup`)).toBe(false);
	});

	it("keeps loose files dropped directly into the root read-only", () => {
		const { protectedDirectory, wikiDirectory } = createFixture();
		const classifier = createClassifier(protectedDirectory, wikiDirectory);

		expect(classifier.isReadOnlyPath(join(protectedDirectory, "report.pdf"))).toBe(true);
	});

	it("allows authoring a new entry subtree and keeps its follow-up files writable", () => {
		const { protectedDirectory, wikiDirectory } = createFixture();
		const classifier = createClassifier(protectedDirectory, wikiDirectory);
		const skillFile = join(protectedDirectory, "created", "SKILL.md");

		expect(classifier.isReadOnlyPath(skillFile)).toBe(false);
		mkdirSync(join(protectedDirectory, "created"));
		writeFileSync(skillFile, "authored");

		expect(classifier.isReadOnlyPath(skillFile)).toBe(false);
		expect(classifier.isReadOnlyPath(join(protectedDirectory, "created", "references", "notes.md"))).toBe(false);
	});

	it("keeps entries authored by other sessions read-only", () => {
		const { protectedDirectory, wikiDirectory } = createFixture();
		const classifier = createClassifier(protectedDirectory, wikiDirectory);
		mkdirSync(join(protectedDirectory, "created"));
		writeFileSync(join(protectedDirectory, "created", "SKILL.md"), "installed");

		expect(
			createClassifier(protectedDirectory, wikiDirectory).isReadOnlyPath(
				join(protectedDirectory, "created", "SKILL.md"),
			),
		).toBe(true);
		expect(classifier.isReadOnlyPath(join(protectedDirectory, "created", "SKILL.md"))).toBe(true);
	});
});
