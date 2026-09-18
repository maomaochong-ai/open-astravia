import { describe, expect, it } from "vitest";
import {
	nextPetMousePollMs,
	PET_MOUSE_POLL_FAR_MS,
	PET_MOUSE_POLL_NEAR_MS,
	PET_MOUSE_POLL_PROXIMITY_PX,
} from "./pet-mouse-poll";

const windowBounds = { x: 1200, y: 700, width: 220, height: 220 };

describe("nextPetMousePollMs", () => {
	it("polls at 20 Hz while dragging or when the cursor is near the widget", () => {
		expect(
			nextPetMousePollMs({
				dragging: true,
				cursor: { x: 0, y: 0 },
				windowBounds,
			}),
		).toBe(PET_MOUSE_POLL_NEAR_MS);
		expect(
			nextPetMousePollMs({
				dragging: false,
				cursor: { x: windowBounds.x + 10, y: windowBounds.y + 10 },
				windowBounds,
			}),
		).toBe(PET_MOUSE_POLL_NEAR_MS);
		expect(
			nextPetMousePollMs({
				dragging: false,
				cursor: {
					x: windowBounds.x - PET_MOUSE_POLL_PROXIMITY_PX,
					y: windowBounds.y,
				},
				windowBounds,
			}),
		).toBe(PET_MOUSE_POLL_NEAR_MS);
	});

	it("slows the poll when the cursor is far from the widget", () => {
		expect(
			nextPetMousePollMs({
				dragging: false,
				cursor: { x: 10, y: 10 },
				windowBounds,
			}),
		).toBe(PET_MOUSE_POLL_FAR_MS);
	});
});
