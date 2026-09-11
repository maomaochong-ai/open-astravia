import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendProtectedDirectoryWarning,
	detectDirectoryChanges,
	snapshotDirectories,
} from "../../../src/coding/shared/protected-directory-changes.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
	temporaryDirectories.length = 0;
});

function createProtectedDirectory(): string {
	const root = mkdtempSync(join(tmpdir(), "vetta-protected-changes-"));
	temporaryDirectories.push(root);
	const protectedDirectory = join(root, "skills");
	mkdirSync(protectedDirectory, { recursive: true });
	return protectedDirectory;
}

describe("protected directory changes", () => {
	it("reports files written into an entry that already existed", () => {
		const protectedDirectory = createProtectedDirectory();
		mkdirSync(join(protectedDirectory, "installed"));
		writeFileSync(join(protectedDirectory, "installed", "SKILL.md"), "installed");
		const before = snapshotDirectories([protectedDirectory]);

		const artifact = join(protectedDirectory, "installed", "output.txt");
		writeFileSync(artifact, "artifact");
		const changed = detectDirectoryChanges(before, snapshotDirectories([protectedDirectory]), [protectedDirectory]);

		expect(changed).toEqual([artifact]);
		expect(appendProtectedDirectoryWarning("(no output)", changed)).toContain("READ-ONLY");
	});

	it("reports loose files dropped directly into the root", () => {
		const protectedDirectory = createProtectedDirectory();
		const before = snapshotDirectories([protectedDirectory]);

		const artifact = join(protectedDirectory, "report.pdf");
		writeFileSync(artifact, "artifact");

		expect(detectDirectoryChanges(before, snapshotDirectories([protectedDirectory]), [protectedDirectory])).toEqual([
			artifact,
		]);
	});

	it("does not report an entry subtree the command authored from scratch", () => {
		const protectedDirectory = createProtectedDirectory();
		const before = snapshotDirectories([protectedDirectory]);

		mkdirSync(join(protectedDirectory, "created", "references"), { recursive: true });
		writeFileSync(join(protectedDirectory, "created", "SKILL.md"), "authored");
		writeFileSync(join(protectedDirectory, "created", "references", "notes.md"), "authored");
		const changed = detectDirectoryChanges(before, snapshotDirectories([protectedDirectory]), [protectedDirectory]);

		expect(changed).toEqual([]);
		expect(appendProtectedDirectoryWarning("(no output)", changed)).toBe("(no output)");
	});
});
