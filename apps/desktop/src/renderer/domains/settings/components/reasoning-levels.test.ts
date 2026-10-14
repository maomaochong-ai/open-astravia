import { describe, expect, it } from "vitest";
import { moveReasoningLevel } from "./reasoning-levels";

const LEVELS = ["low", "medium", "high"];

describe("moveReasoningLevel", () => {
	it("moves an item down before a later index", () => {
		expect(moveReasoningLevel(LEVELS, 0, 2)).toEqual(["medium", "low", "high"]);
		expect(moveReasoningLevel(LEVELS, 0, 3)).toEqual(["medium", "high", "low"]);
	});

	it("moves an item up", () => {
		expect(moveReasoningLevel(LEVELS, 2, 0)).toEqual(["high", "low", "medium"]);
		expect(moveReasoningLevel(LEVELS, 2, 1)).toEqual(["low", "high", "medium"]);
	});

	it("treats a drop on its own position as a no-op", () => {
		expect(moveReasoningLevel(LEVELS, 1, 1)).toEqual(LEVELS);
		expect(moveReasoningLevel(LEVELS, 1, 2)).toEqual(LEVELS);
	});

	it("does not mutate the source list", () => {
		const levels = [...LEVELS];
		moveReasoningLevel(levels, 0, 3);
		expect(levels).toEqual(LEVELS);
	});

	it("clamps out-of-range input", () => {
		expect(moveReasoningLevel(LEVELS, 9, 0)).toEqual(LEVELS);
		expect(moveReasoningLevel(LEVELS, 0, 99)).toEqual(["medium", "high", "low"]);
	});
});
