import { describe, expect, it } from "vitest";
import { nextHeaderCrowded } from "./header-crowding";

describe("nextHeaderCrowded", () => {
	it("keeps the full button row on a wide header even when a long title fills the middle", () => {
		const wide = nextHeaderCrowded({
			crowded: false,
			containerWidth: 1200,
			leftChromeWidth: 72,
			currentRightWidth: 280,
			expandedRightWidth: 0,
		});
		expect(wide).toEqual({ crowded: false, expandedRightWidth: 280 });
	});

	it("collapses only when the left buttons and the right group no longer fit", () => {
		const packed = nextHeaderCrowded({
			crowded: false,
			containerWidth: 340,
			leftChromeWidth: 72,
			currentRightWidth: 280,
			expandedRightWidth: 0,
		});
		expect(packed).toEqual({ crowded: true, expandedRightWidth: 280 });
	});

	it("does not expand again just because collapsing the right group created space", () => {
		// 展开时右侧 280px，和左侧 72px 一起需要约 364px。收起后右侧只剩 96px，容器仍是 340px。
		const stillTight = nextHeaderCrowded({
			crowded: true,
			containerWidth: 340,
			leftChromeWidth: 72,
			currentRightWidth: 96,
			expandedRightWidth: 280,
		});
		expect(stillTight).toEqual({ crowded: true, expandedRightWidth: 280 });
	});

	it("expands once the full button row would fit again", () => {
		const released = nextHeaderCrowded({
			crowded: true,
			containerWidth: 420,
			leftChromeWidth: 72,
			currentRightWidth: 96,
			expandedRightWidth: 280,
		});
		expect(released.crowded).toBe(false);
		expect(released.expandedRightWidth).toBe(280);
	});

	it("ignores a header that has not been laid out yet", () => {
		expect(
			nextHeaderCrowded({
				crowded: false,
				containerWidth: 0,
				leftChromeWidth: 72,
				currentRightWidth: 280,
				expandedRightWidth: 0,
			}),
		).toEqual({ crowded: false, expandedRightWidth: 0 });
	});
});
