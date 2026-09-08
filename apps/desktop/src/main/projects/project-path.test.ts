import { describe, expect, it } from "vitest";
import { sameProjectPath } from "./project-path.js";

describe("sameProjectPath", () => {
	it("normalizes Windows casing, separators, and trailing separators", () => {
		expect(sameProjectPath("C:\\Projects\\Selected\\", "c:/projects/selected")).toBe(true);
	});

	it("keeps different project paths distinct", () => {
		expect(sameProjectPath("C:/projects/first", "C:/projects/second")).toBe(false);
	});
});
