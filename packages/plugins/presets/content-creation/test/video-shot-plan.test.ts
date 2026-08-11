import { describe, expect, it } from "vitest";
import {
	ContentVideoShotPlanError,
	selectContentVideoShotStrategy,
} from "../src/agent/video-shot-plan";

describe("video shot strategy selection", () => {
	it("selects first/last-frame control when the ending must be exact", () => {
		expect(selectContentVideoShotStrategy({
			requestedStrategy: "automatic",
			controlRequirements: { exactEnding: true },
			hasFirstFramePlan: true,
			hasLastFramePlan: true,
			sources: [],
		})).toBe("first-last-frame");
	});

	it("selects omni-reference for several independent visual authorities", () => {
		expect(selectContentVideoShotStrategy({
			requestedStrategy: "automatic",
			controlRequirements: { requiresSceneReference: true },
			hasFirstFramePlan: false,
			hasLastFramePlan: false,
			sources: [
				{ kind: "image", semanticRole: "identity" },
				{ kind: "image", semanticRole: "identity" },
				{ kind: "image", semanticRole: "environment" },
			],
		})).toBe("omni-reference");
	});

	it("never silently degrades an exact ending to animate-still", () => {
		expect(() => selectContentVideoShotStrategy({
			requestedStrategy: "animate-still",
			controlRequirements: { exactEnding: true },
			hasFirstFramePlan: true,
			hasLastFramePlan: true,
			sources: [{ kind: "image", semanticRole: "composition" }],
		})).toThrowError(new ContentVideoShotPlanError(
			"animate-still cannot satisfy an exact final-frame requirement",
			"video-shot-strategy-conflict",
			{ requestedStrategy: "animate-still", recommendedStrategy: "first-last-frame" },
		));
	});

	it("requires a real opening authority when the first frame must be exact", () => {
		expect(() => selectContentVideoShotStrategy({
			requestedStrategy: "automatic",
			controlRequirements: { exactOpening: true },
			hasFirstFramePlan: false,
			hasLastFramePlan: false,
			sources: [],
		})).toThrowError(expect.objectContaining({ code: "video-shot-opening-authority-required" }));
	});
});
