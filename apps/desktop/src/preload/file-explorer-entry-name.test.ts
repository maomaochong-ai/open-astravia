import { describe, expect, it } from "vitest";
import { getFileExplorerEntryNameIssue } from "./file-explorer-entry-name";

describe("getFileExplorerEntryNameIssue", () => {
	it("accepts common file names", () => {
		expect(getFileExplorerEntryNameIssue("notes.md", { windows: true })).toBeNull();
		expect(getFileExplorerEntryNameIssue(".env", { windows: true })).toBeNull();
	});

	it("rejects empty and traversal names", () => {
		expect(getFileExplorerEntryNameIssue("  ", { windows: false })).toBe("empty");
		expect(getFileExplorerEntryNameIssue("..", { windows: false })).toBe("dot-path");
	});

	it("rejects path separators on every platform", () => {
		expect(getFileExplorerEntryNameIssue("nested/file.txt", { windows: false })).toBe("path-separator");
		expect(getFileExplorerEntryNameIssue("nested\\file.txt", { windows: false })).toBe("path-separator");
	});

	it("applies Windows-specific restrictions", () => {
		expect(getFileExplorerEntryNameIssue("report?.txt", { windows: true })).toBe("invalid-character");
		expect(getFileExplorerEntryNameIssue("CON.txt", { windows: true })).toBe("reserved-name");
		expect(getFileExplorerEntryNameIssue("report. ", { windows: true })).toBe("trailing-character");
	});

	it("does not apply Windows-specific restrictions on other platforms", () => {
		expect(getFileExplorerEntryNameIssue("report?.txt", { windows: false })).toBeNull();
		expect(getFileExplorerEntryNameIssue("CON.txt", { windows: false })).toBeNull();
	});
});
