import { describe, expect, it } from "vitest";
import { isAllowedMainWindowAudioRequest } from "./media-permissions.js";

describe("isAllowedMainWindowAudioRequest", () => {
	it("allows audio from the main frame of the trusted window", () => {
		expect(
			isAllowedMainWindowAudioRequest({
				webContentsMatches: true,
				isMainFrame: true,
				mediaTypes: ["audio"],
			}),
		).toBe(true);
	});

	it.each([
		{ webContentsMatches: false, isMainFrame: true, mediaTypes: ["audio"] as const },
		{ webContentsMatches: true, isMainFrame: false, mediaTypes: ["audio"] as const },
		{ webContentsMatches: true, isMainFrame: true, mediaTypes: ["video"] as const },
		{ webContentsMatches: true, isMainFrame: true, mediaTypes: ["audio", "video"] as const },
	])("denies untrusted, subframe, and video requests", (context) => {
		expect(isAllowedMainWindowAudioRequest(context)).toBe(false);
	});
});
