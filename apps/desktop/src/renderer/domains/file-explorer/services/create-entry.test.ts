import { join } from "node:path";
import type { FsEntry } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { resolveCreateParentDirectory } from "./create-entry";

function entry(path: string, isDirectory: boolean): FsEntry {
	return {
		name: path.split(/[\\/]/).at(-1) ?? path,
		path,
		isDirectory,
		size: 0,
		modifiedAt: 0,
	};
}

describe("resolveCreateParentDirectory", () => {
	const root = join("workspace", "project");

	it("uses the root when nothing is selected", () => {
		expect(resolveCreateParentDirectory(root, null)).toBe(root);
	});

	it("creates inside a selected directory", () => {
		const directory = join(root, "docs");
		expect(resolveCreateParentDirectory(root, entry(directory, true))).toBe(directory);
	});

	it("creates beside a selected file", () => {
		const directory = join(root, "src");
		expect(resolveCreateParentDirectory(root, entry(join(directory, "index.ts"), false))).toBe(directory);
	});
});
