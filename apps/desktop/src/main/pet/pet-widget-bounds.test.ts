import { describe, expect, it } from "vitest";
import type { PetContentBounds } from "../../shared/pet-ipc";
import {
	initialPetVideoScreen,
	layoutPetWidget,
	normalizePetContentBounds,
	squarePetContent,
	videoScreenForContentResize,
	videoScreenRectFromWindow,
} from "./pet-widget-bounds";

const workArea = { x: 0, y: 25, width: 1440, height: 875 };
const SPRITE = 220;
const BUBBLE_EXTRA_LEFT = 70;
const BUBBLE_EXTRA_HEIGHT = 80;

/** 渲染层按给定放置方向 / 平移排好长气泡后会上报的布局（宽 360、高 300、精灵 220）。 */
function longBubbleContent(offset: { x: number; y: number }): PetContentBounds {
	return {
		bounds: { x: 0, y: 0, width: 360, height: SPRITE + BUBBLE_EXTRA_HEIGHT },
		anchor: {
			x: BUBBLE_EXTRA_LEFT + offset.x,
			y: offset.y < 0 ? 0 : BUBBLE_EXTRA_HEIGHT,
			width: SPRITE,
			height: SPRITE,
		},
		contentOffset: offset,
	};
}

describe("layoutPetWidget", () => {
	it("keeps the video's screen position when the window shrinks to the sprite", () => {
		const layout = layoutPetWidget({
			workArea,
			videoScreen: { x: 1100, y: 600, width: SPRITE, height: SPRITE },
			content: squarePetContent(SPRITE),
		});
		expect(layout.windowBounds).toEqual({ x: 1100, y: 600, width: SPRITE, height: SPRITE });
		expect(layout.videoScreen).toEqual({ x: 1100, y: 600, width: SPRITE, height: SPRITE });
		expect(layout.contentOffset).toEqual({ x: 0, y: 1 });
		expect(layout.contentInSync).toBe(true);
	});

	it("grows upward for a bubble above the sprite without moving the video", () => {
		const layout = layoutPetWidget({
			workArea,
			videoScreen: { x: 1100, y: 600, width: SPRITE, height: SPRITE },
			content: longBubbleContent({ x: 0, y: 1 }),
		});
		expect(layout.windowBounds).toEqual({ x: 1030, y: 520, width: 360, height: 300 });
		expect(layout.windowBounds.x + BUBBLE_EXTRA_LEFT).toBe(1100);
		expect(layout.windowBounds.y + BUBBLE_EXTRA_HEIGHT).toBe(600);
		expect(layout.contentInSync).toBe(true);
	});

	it("keeps the sprite still when a bubble appears and the old window clips the new hitbox", () => {
		const lastVideoScreen = { x: 1100, y: 600, width: SPRITE, height: SPRITE };
		const videoScreen = videoScreenForContentResize({
			lastVideoScreen,
			windowBounds: lastVideoScreen,
			hitbox: { x: 70, y: 80, width: SPRITE, height: 140 },
		});
		const layout = layoutPetWidget({ workArea, videoScreen, content: longBubbleContent({ x: 0, y: 1 }) });
		expect(layout.windowBounds.x + BUBBLE_EXTRA_LEFT).toBe(1100);
		expect(layout.windowBounds.y + BUBBLE_EXTRA_HEIGHT).toBe(600);
	});

	describe("long bubble at the default lower-right position", () => {
		const defaultSprite = initialPetVideoScreen(workArea, SPRITE, 24);

		it("shifts the bubble inward instead of pushing the sprite off its spot", () => {
			const layout = layoutPetWidget({
				workArea,
				videoScreen: defaultSprite,
				content: longBubbleContent({ x: 0, y: 1 }),
			});
			// 精灵的逻辑位置不变，需要渲染层把精灵在窗口内右移 46px 让气泡内收。
			expect(layout.videoScreen).toEqual(defaultSprite);
			expect(layout.contentOffset).toEqual({ x: 46, y: 1 });
			expect(layout.contentInSync).toBe(false);
			// 预测窗口就已经让精灵留在原地、气泡在工作区内。
			expect(layout.windowBounds.x + BUBBLE_EXTRA_LEFT + 46).toBe(defaultSprite.x);
			expect(layout.windowBounds.y + BUBBLE_EXTRA_HEIGHT).toBe(defaultSprite.y);
			expect(layout.windowBounds.x + layout.windowBounds.width).toBe(workArea.x + workArea.width);
		});

		it("aligns the window exactly once the renderer reports the shifted layout", () => {
			const layout = layoutPetWidget({
				workArea,
				videoScreen: defaultSprite,
				content: longBubbleContent({ x: 46, y: 1 }),
			});
			expect(layout.contentInSync).toBe(true);
			expect(layout.contentOffset).toEqual({ x: 46, y: 1 });
			expect(layout.videoScreen).toEqual(defaultSprite);
			expect(layout.windowBounds).toEqual({ x: 1080, y: 576, width: 360, height: 300 });
			expect(layout.windowBounds.x + BUBBLE_EXTRA_LEFT + 46).toBe(defaultSprite.x);
			expect(layout.windowBounds.y + BUBBLE_EXTRA_HEIGHT).toBe(defaultSprite.y);
			expect(layout.windowBounds.x + layout.windowBounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
			expect(layout.windowBounds.y + layout.windowBounds.height).toBeLessThanOrEqual(workArea.y + workArea.height);
		});

		it("shrinks the window back to the untouched sprite position when the bubble disappears", () => {
			const layout = layoutPetWidget({
				workArea,
				videoScreen: defaultSprite,
				content: {
					...squarePetContent(SPRITE),
					// 气泡刚消失时渲染层仍带着上一轮的平移。
					anchor: { x: 46, y: 0, width: SPRITE, height: SPRITE },
					contentOffset: { x: 46, y: 1 },
				},
			});
			expect(layout.contentOffset).toEqual({ x: 0, y: 1 });
			expect(layout.videoScreen).toEqual(defaultSprite);
			expect(layout.windowBounds).toEqual(defaultSprite);
		});
	});

	it("shifts the sprite the other way when the bubble would spill past the left edge", () => {
		const layout = layoutPetWidget({
			workArea,
			videoScreen: { x: 24, y: 600, width: SPRITE, height: SPRITE },
			content: longBubbleContent({ x: 0, y: 1 }),
		});
		expect(layout.contentOffset).toEqual({ x: -46, y: 1 });
		expect(layout.videoScreen.x).toBe(24);
		expect(layout.windowBounds.x).toBe(workArea.x);
		expect(layout.windowBounds.x + BUBBLE_EXTRA_LEFT - 46).toBe(24);
	});

	describe("sprite against the top edge", () => {
		const topSprite = { x: 700, y: workArea.y, width: SPRITE, height: SPRITE };

		it("decides on placing the bubble below before any clamping, so the window never starts above", () => {
			const layout = layoutPetWidget({
				workArea,
				videoScreen: topSprite,
				content: longBubbleContent({ x: 0, y: 1 }),
			});
			expect(layout.contentOffset).toEqual({ x: 0, y: -1 });
			expect(layout.contentInSync).toBe(false);
			expect(layout.videoScreen).toEqual(topSprite);
			expect(layout.windowBounds).toEqual({ x: 630, y: workArea.y, width: 360, height: 300 });
		});

		it("keeps the same placement once the renderer reports the bubble below", () => {
			const layout = layoutPetWidget({
				workArea,
				videoScreen: topSprite,
				content: longBubbleContent({ x: 0, y: -1 }),
			});
			expect(layout.contentOffset).toEqual({ x: 0, y: -1 });
			expect(layout.contentInSync).toBe(true);
			expect(layout.windowBounds).toEqual({ x: 630, y: workArea.y, width: 360, height: 300 });
		});

		it("pre-selects below while the sprite is docked at the top even without a bubble", () => {
			const layout = layoutPetWidget({ workArea, videoScreen: topSprite, content: squarePetContent(SPRITE) });
			expect(layout.contentOffset).toEqual({ x: 0, y: -1 });
			expect(layout.windowBounds).toEqual(topSprite);
		});

		it("keeps the bubble above when the sprite has room above it", () => {
			const layout = layoutPetWidget({
				workArea,
				videoScreen: { x: 1100, y: 600, width: SPRITE, height: SPRITE },
				content: longBubbleContent({ x: 0, y: 1 }),
			});
			expect(layout.contentOffset).toEqual({ x: 0, y: 1 });
		});
	});

	it("clamps only the sprite itself when it falls outside the work area", () => {
		const layout = layoutPetWidget({
			workArea,
			videoScreen: { x: 1500, y: 900, width: SPRITE, height: SPRITE },
			content: squarePetContent(SPRITE),
		});
		expect(layout.videoScreen).toEqual({ x: 1220, y: 680, width: SPRITE, height: SPRITE });
		expect(layout.windowBounds).toEqual({ x: 1220, y: 680, width: SPRITE, height: SPRITE });
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

	it("defaults a missing content offset to bubble above with no shift", () => {
		expect(
			normalizePetContentBounds({
				bounds: { x: 0, y: 0, width: 220, height: 220 },
				anchor: { x: 0, y: 0, width: 220, height: 220 },
			}).contentOffset,
		).toEqual({ x: 0, y: 1 });
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
