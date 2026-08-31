// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { toolCallDurationMs, toolCallIconColorClass } from "./parse-tool";

describe("toolCallIconColorClass", () => {
	it("paints success green and keeps pending muted", () => {
		expect(toolCallIconColorClass("success")).toBe("text-emerald-400");
		expect(toolCallIconColorClass("pending")).toBe("text-muted-foreground/50");
	});

	it("paints the icon when the call failed", () => {
		expect(toolCallIconColorClass("error")).toBe("text-destructive/70");
		expect(toolCallIconColorClass("success", true)).toBe("text-destructive/70");
	});
});

describe("toolCallDurationMs", () => {
	it("shows the live elapsed ticker while pending", () => {
		expect(toolCallDurationMs("pending", undefined, 0)).toBe(0);
		expect(toolCallDurationMs("pending", undefined, 1500)).toBe(1500);
		expect(toolCallDurationMs("pending", 5000, null)).toBeNull();
	});

	it("shows the recorded duration for completed calls, including sub-second", () => {
		expect(toolCallDurationMs("success", 12, null)).toBe(12);
		expect(toolCallDurationMs("success", 1200, null)).toBe(1200);
		expect(toolCallDurationMs("error", 2400, null)).toBe(2400);
		expect(toolCallDurationMs("success", undefined, null)).toBeNull();
	});
});
