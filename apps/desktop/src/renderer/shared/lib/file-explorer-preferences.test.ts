import { describe, expect, it } from "vitest";
import {
	createFileExplorerVisibility,
	DEFAULT_FILE_EXPLORER_PREFERENCES,
	normalizeFileExplorerPreferences,
} from "./file-explorer-preferences";

describe("file explorer display preferences", () => {
	it("shows dotfiles by default and makes system exclusions reversible", () => {
		const visible = createFileExplorerVisibility("C:\\project", DEFAULT_FILE_EXPLORER_PREFERENCES);
		expect(visible("C:\\project\\.github\\workflows\\test.yml")).toBe(true);
		expect(visible("C:\\project\\.env")).toBe(true);
		expect(visible("C:\\project\\desktop.ini")).toBe(false);
		expect(
			createFileExplorerVisibility("C:/project", { ...DEFAULT_FILE_EXPLORER_PREFERENCES, exclude: [] })(
				"C:/project/desktop.ini",
			),
		).toBe(true);
	});
	it("filters descendants and dotfiles independently from glob rules", () => {
		const visible = createFileExplorerVisibility("/project", {
			...DEFAULT_FILE_EXPLORER_PREFERENCES,
			showHidden: false,
			exclude: ["**/node_modules", "**/*.log"],
		});
		for (const path of [".env", ".github/ci.yml", "pkg/node_modules/foo/index.js", "pkg/server.log"])
			expect(visible(`/project/${path}`)).toBe(false);
		expect(visible("/project/pkg/index.ts")).toBe(true);
		expect(visible("/project-other/index.ts")).toBe(false);
	});
	it("recovers malformed or future preferences without compiling unbounded patterns", () => {
		for (const value of [
			null,
			{ schemaVersion: 2 },
			{ schemaVersion: 1, exclude: [42] },
			{ schemaVersion: 1, exclude: ["x".repeat(66000)] },
		]) {
			expect(normalizeFileExplorerPreferences(value)).toEqual(DEFAULT_FILE_EXPLORER_PREFERENCES);
		}
	});
});
