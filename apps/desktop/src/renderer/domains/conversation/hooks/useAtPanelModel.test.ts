import { describe, expect, it } from "vitest";
import { normalizeAtPanelDirectory } from "./useAtPanelModel";

describe("normalizeAtPanelDirectory", () => {
	it("rejects missing and blank directories before they reach filesystem IPC", () => {
		expect(normalizeAtPanelDirectory(undefined)).toBeUndefined();
		expect(normalizeAtPanelDirectory("  ")).toBeUndefined();
	});

	it("trims a usable directory", () => {
		expect(normalizeAtPanelDirectory("  C:/workspace  ")).toBe("C:/workspace");
	});
});
