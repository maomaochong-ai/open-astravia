import { describe, expect, it } from "vitest";
import { shouldOpenConnectionCreateMenu } from "../src/canvas/connection-drop-menu";

describe("shouldOpenConnectionCreateMenu", () => {
	it("opens when a connection is dropped on empty canvas", () => {
		expect(
			shouldOpenConnectionCreateMenu({
				isValid: false,
				fromNodeId: "a",
				toNodeId: null,
				hasFromHandle: true,
			}),
		).toBe(true);
	});

	it("opens when the drag ends over the same source node (bookmark self-hit)", () => {
		expect(
			shouldOpenConnectionCreateMenu({
				isValid: false,
				fromNodeId: "a",
				toNodeId: "a",
				hasFromHandle: true,
			}),
		).toBe(true);
	});

	it("does not open after a completed valid connection", () => {
		expect(
			shouldOpenConnectionCreateMenu({
				isValid: true,
				fromNodeId: "a",
				toNodeId: "b",
				hasFromHandle: true,
			}),
		).toBe(false);
	});

	it("does not open when dropped on a different node", () => {
		expect(
			shouldOpenConnectionCreateMenu({
				isValid: false,
				fromNodeId: "a",
				toNodeId: "b",
				hasFromHandle: true,
			}),
		).toBe(false);
	});

	it("does not open without a from handle", () => {
		expect(
			shouldOpenConnectionCreateMenu({
				isValid: false,
				fromNodeId: "a",
				toNodeId: null,
				hasFromHandle: false,
			}),
		).toBe(false);
	});
});
