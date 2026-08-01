import type { FsEntry } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { resolvePasteDirectory } from "./clipboard";

function entry(path: string, isDirectory: boolean): FsEntry {
	return { name: path.split(/[/\\]/).pop() ?? path, path, isDirectory, size: 0, modifiedAt: 0 };
}

describe("resolvePasteDirectory", () => {
	it("uses root when nothing is selected (blank area paste)", () => {
		expect(resolvePasteDirectory("/root", null, [])).toBe("/root");
	});

	it("pastes into a focused directory", () => {
		expect(resolvePasteDirectory("/root", entry("/root/docs", true), [])).toBe("/root/docs");
	});

	it("pastes beside a focused file", () => {
		expect(resolvePasteDirectory("/root", entry("/root/docs/a.txt", false), [])).toBe("/root/docs");
	});
});
