import { describe, expect, it } from "vitest";
import { clientRectToHitbox, measurePetWidgetContent } from "./pet-widget-content";

describe("measurePetWidgetContent", () => {
	it("sizes the widget window to the shell and keeps the sprite as the move anchor", () => {
		expect(
			measurePetWidgetContent({
				shell: { width: 360, height: 300 },
				video: { left: 70, top: 80, width: 220, height: 220 },
			}),
		).toEqual({
			bounds: { x: 0, y: 0, width: 360, height: 300 },
			anchor: { x: 70, y: 80, width: 220, height: 220 },
		});
	});

	it("uses the shell as the anchor when the sprite is not on screen yet", () => {
		expect(measurePetWidgetContent({ shell: { width: 220, height: 220 } })).toEqual({
			bounds: { x: 0, y: 0, width: 220, height: 220 },
			anchor: { x: 0, y: 0, width: 220, height: 220 },
		});
	});
});

describe("clientRectToHitbox", () => {
	it("clips the sprite to the current window viewport", () => {
		expect(clientRectToHitbox({ left: -10, top: 8, right: 230, bottom: 228 }, { width: 220, height: 300 })).toEqual({
			x: 0,
			y: 8,
			width: 220,
			height: 220,
		});
	});
});
