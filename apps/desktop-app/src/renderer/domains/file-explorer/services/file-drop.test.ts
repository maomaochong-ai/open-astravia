import { describe, expect, it } from "vitest";
import { isProjectInternalDrop } from "./file-drop";

describe("isProjectInternalDrop", () => {
	it("recognizes files inside a project with mixed Windows separators and casing", () => {
		expect(
			isProjectInternalDrop(["C:\\Work\\Project\\src\\index.ts", "c:/work/project/README.md"], "C:\\work\\project"),
		).toBe(true);
	});

	it("rejects sibling and mixed external paths", () => {
		expect(isProjectInternalDrop(["/work/project-a/file.ts"], "/work/project")).toBe(false);
		expect(isProjectInternalDrop(["/work/project/file.ts", "/desktop/note.txt"], "/work/project")).toBe(false);
		expect(isProjectInternalDrop([], "/work/project")).toBe(false);
	});
});
