import { describe, expect, it } from "vitest";
import { composeComposerCapabilities } from "./capabilities";

type Region = "routing" | "toolbar";

describe("composeComposerCapabilities", () => {
	it("composes enabled abilities and orders their contributions deterministically", () => {
		const composition = composeComposerCapabilities<Region, string>([
			{
				id: "routing",
				contributions: [{ id: "members", region: "routing", value: "members" }],
			},
			false,
			{
				id: "send",
				requires: ["routing"],
				contributions: [
					{ id: "send", region: "toolbar", order: 20, value: "send" },
					{ id: "attach", region: "toolbar", order: 10, value: "attach" },
				],
			},
		]);

		expect(composition.has("routing")).toBe(true);
		expect(composition.has("missing")).toBe(false);
		expect(composition.get("toolbar").map((item) => item.value)).toEqual(["attach", "send"]);
	});

	it("rejects duplicate, incomplete, and conflicting capability graphs", () => {
		expect(() => composeComposerCapabilities([{ id: "same" }, { id: "same" }])).toThrow(
			"Duplicate composer capability",
		);
		expect(() => composeComposerCapabilities([{ id: "history", requires: ["draft"] }])).toThrow('requires "draft"');
		expect(() => composeComposerCapabilities([{ id: "single" }, { id: "team", conflicts: ["single"] }])).toThrow(
			'conflicts with "single"',
		);
	});

	it("keeps an installed capability contribution when its current value is empty", () => {
		const composition = composeComposerCapabilities<Region, string | null>([
			{
				id: "todo",
				contributions: [{ id: "status", region: "toolbar", value: null }],
			},
		]);

		expect(composition.has("todo")).toBe(true);
		expect(composition.get("toolbar")).toMatchObject([
			{
				capabilityId: "todo",
				value: null,
			},
		]);
	});
});
