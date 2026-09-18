import { describe, expect, it } from "vitest";
import {
	initialPetVideoScreen,
	nextPetWindowBounds,
	normalizePetContentBounds,
	petContentOffsetForBubblePlacement,
	squarePetContent,
	videoScreenForContentResize,
	videoScreenRectFromWindow,
} from "./pet-widget-bounds";

describe("nextPetWindowBounds", () => {
	const workArea = { x: 0, y: 25, width: 1440, height: 875 };

	it("keeps the video's screen position when the window shrinks to the sprite", () => {
		const bounds = nextPetWindowBounds({
			workArea,
			videoScreen: { x: 1100, y: 600, width: 220, height: 220 },
			content: squarePetContent(220),
		});
		expect(bounds).toEqual({ x: 1100, y: 600, width: 220, height: 220 });
	});

	it("grows upward for a bubble above the sprite without moving the video", () => {
		const bounds = nextPetWindowBounds({
			workArea,
			videoScreen: { x: 1100, y: 600, width: 220, height: 220 },
			content: {
				bounds: { x: 0, y: 0, width: 360, height: 300 },
				anchor: { x: 70, y: 80, width: 220, height: 220 },
			},
		});
		expect(bounds).toEqual({ x: 1030, y: 520, width: 360, height: 300 });
		expect(bounds.x + 70).toBe(1100);
		expect(bounds.y + 80).toBe(600);
	});

	it("clamps to the work area when the pet sits on the right edge", () => {
		const bounds = nextPetWindowBounds({
			workArea,
			videoScreen: { x: 1300, y: 700, width: 220, height: 220 },
			content: {
				bounds: { x: 0, y: 0, width: 360, height: 300 },
				anchor: { x: 70, y: 80, width: 220, height: 220 },
			},
		});
		expect(bounds.x + bounds.width).toBe(workArea.x + workArea.width);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height);
	});

	it("keeps the sprite still when a bubble appears and the old window clips the new hitbox", () => {
		const lastVideoScreen = { x: 1100, y: 600, width: 220, height: 220 };
		const videoScreen = videoScreenForContentResize({
			lastVideoScreen,
			windowBounds: lastVideoScreen,
			hitbox: { x: 70, y: 80, width: 220, height: 140 },
		});
		const bounds = nextPetWindowBounds({
			workArea,
			videoScreen,
			content: {
				bounds: { x: 0, y: 0, width: 360, height: 300 },
				anchor: { x: 70, y: 80, width: 220, height: 220 },
			},
		});
		expect(bounds.x + 70).toBe(1100);
		expect(bounds.y + 80).toBe(600);
	});
});

describe("videoScreenRectFromWindow", () => {
	it("maps the window-local hitbox onto the screen", () => {
		expect(
			videoScreenRectFromWindow(
				{ x: 100, y: 200, width: 400, height: 400 },
				{ x: 10, y: 20, width: 220, height: 220 },
			),
		).toEqual({ x: 110, y: 220, width: 220, height: 220 });
	});
});

describe("normalizePetContentBounds", () => {
	it("treats a numeric size as a square sprite window", () => {
		expect(normalizePetContentBounds(180)).toEqual(squarePetContent(180));
	});
});

describe("initialPetVideoScreen", () => {
	it("places the default sprite at the lower-right of the work area", () => {
		expect(initialPetVideoScreen({ x: 0, y: 25, width: 1440, height: 875 }, 220, 24)).toEqual({
			x: 1196,
			y: 656,
			width: 220,
			height: 220,
		});
	});
});

describe("videoScreenForContentResize", () => {
	it("keeps the previous sprite screen position when a bubble reflows inside the old window", () => {
		expect(
			videoScreenForContentResize({
				lastVideoScreen: { x: 1100, y: 600, width: 220, height: 220 },
				windowBounds: { x: 1100, y: 600, width: 220, height: 220 },
				hitbox: { x: 70, y: 80, width: 220, height: 140 },
			}),
		).toEqual({ x: 1100, y: 600, width: 220, height: 220 });
	});
});

describe("petContentOffsetForBubblePlacement", () => {
	it("asks the renderer to put the bubble below the sprite when the window is against the top edge", () => {
		expect(
			petContentOffsetForBubblePlacement(
				{ x: 100, y: 25, width: 220, height: 300 },
				{ x: 0, y: 25, width: 1440, height: 875 },
			),
		).toEqual({ x: 0, y: -1 });
	});

	it("keeps the bubble above the sprite when the window is away from the top edge", () => {
		expect(
			petContentOffsetForBubblePlacement(
				{ x: 1100, y: 600, width: 220, height: 220 },
				{ x: 0, y: 25, width: 1440, height: 875 },
			),
		).toEqual({ x: 0, y: 1 });
	});
});
