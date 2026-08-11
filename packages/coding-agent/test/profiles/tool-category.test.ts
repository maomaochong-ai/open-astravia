import { describe, expect, it } from "vitest";
import { resolveToolCategory } from "../../src/profiles/index.js";

describe("tool category", () => {
	it("preserves supported categories", () => {
		expect(resolveToolCategory("kb-read")).toBe("kb-read");
		expect(resolveToolCategory("agent-control")).toBe("agent-control");
	});

	it("normalizes absent or unsupported extension metadata", () => {
		expect(resolveToolCategory(undefined)).toBe("external");
		expect(resolveToolCategory("custom")).toBe("external");
	});
});
