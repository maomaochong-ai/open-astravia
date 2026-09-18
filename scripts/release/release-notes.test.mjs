import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopVersion, releaseNotesPath, requireReleaseNotes } from "./release-notes.mjs";

const roots = [];

function fixtureRoot(version, notesVersions = []) {
	const root = mkdtempSync(join(tmpdir(), "vetta-release-notes-"));
	roots.push(root);
	mkdirSync(join(root, "apps/desktop"), { recursive: true });
	writeFileSync(join(root, "apps/desktop/package.json"), JSON.stringify({ version }));
	mkdirSync(join(root, ".github/release-notes"), { recursive: true });
	for (const notesVersion of notesVersions) {
		writeFileSync(join(root, ".github/release-notes", `v${notesVersion}.md`), `# Vetta ${notesVersion}\n`);
	}
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("release notes addressing", () => {
	it("maps a version to its release notes file", () => {
		expect(releaseNotesPath("0.5.58")).toBe(".github/release-notes/v0.5.58.md");
	});

	it("rejects a version that is not semver", () => {
		expect(() => releaseNotesPath("0.5")).toThrow(/Invalid release version/);
		expect(() => releaseNotesPath("v0.5.58")).toThrow(/Invalid release version/);
	});

	it("resolves the desktop version from the package manifest", () => {
		expect(desktopVersion(fixtureRoot("0.5.58"))).toBe("0.5.58");
	});

	it("returns the path when the notes exist", () => {
		const root = fixtureRoot("0.5.58", ["0.5.58"]);
		expect(requireReleaseNotes("0.5.58", root)).toBe(".github/release-notes/v0.5.58.md");
	});

	// 缺发布说明必须拦住发版：它就是 Release 的正文，补不上就没有正文可发。
	it("explains how to fix a missing release note", () => {
		const root = fixtureRoot("0.5.59", ["0.5.58"]);
		expect(() => requireReleaseNotes("0.5.59", root)).toThrow(/Missing release notes for v0\.5\.59/);
		expect(() => requireReleaseNotes("0.5.59", root)).toThrow(/release-notes\/README\.md/);
	});

	it("ships release notes for the version this repository is about to release", () => {
		expect(requireReleaseNotes(desktopVersion())).toMatch(/^\.github\/release-notes\/v\d+\.\d+\.\d+\.md$/);
	});
});
