import { describe, expect, it } from "vitest";
import {
	compileKeyframePromptPlan,
	parseKeyframePromptPlan,
} from "../src/agent/keyframe-prompt-plan";

describe("keyframe prompt plan", () => {
	it("compiles a static first-frame contract without reusing video directing language", () => {
		const prompt = compileKeyframePromptPlan(parseKeyframePromptPlan(createKeyframePlan("first")));

		expect(prompt).toContain("Keyframe phase: first frame.");
		expect(prompt).toContain("Frozen visible state:");
		expect(prompt).toContain("Camera axis:");
		expect(prompt).not.toContain("Primary action:");
	});

	it("rejects an incomplete static keyframe plan with actionable fields", () => {
		expect(() => parseKeyframePromptPlan({ kind: "image-keyframe", phase: "last" })).toThrowError(
			expect.objectContaining({
				code: "keyframe-prompt-plan-invalid",
				details: expect.objectContaining({ missing: expect.arrayContaining(["visibleState", "composition.cameraAxis"]) }),
			}),
		);
	});
});

function createKeyframePlan(phase: "first" | "last") {
	return {
		kind: "image-keyframe",
		phase,
		sceneFunction: "Opening authority frame for a continuous dance shot",
		referenceRole: "Preserve the supplied dancer identity and ballroom layout",
		protectedInvariants: ["same two dancers", "same costumes", "same ballroom"],
		visibleState: phase === "first"
			? "Dancer A holds a poised opening step on the left while dancer B waits in the distance"
			: "Both dancers meet at center frame with hands almost touching and calm delighted expressions",
		composition: {
			framing: "Wide full-body two-shot",
			angle: "Eye-level camera",
			placement: phase === "first" ? "Dancer A left, dancer B deep right" : "Both dancers centered",
			cameraAxis: "Camera faces the ballroom stage along the center aisle",
		},
		environment: "Warm ballroom with polished floor and tall windows",
		lighting: {
			setup: "Soft evening key light with warm practical chandeliers",
			direction: "Key light enters from camera left",
		},
		style: "Natural cinematic photography with restrained contrast",
		constraints: ["single frozen moment", "no motion blur", "no identity drift"],
	};
}
