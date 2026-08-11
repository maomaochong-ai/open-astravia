import { describe, expect, it } from "vitest";
import {
	ContentGenerationPromptPlanError,
	analyzeVideoPromptMethod,
	compileVideoPromptPlan,
	parseVideoPromptPlan,
} from "../src/agent/generation-prompt-plan";

const COMPLETE_PLAN = {
	kind: "video-shot",
	sceneFunction: "reveal product material and finish on a clean brand frame",
	referenceRole: "the source image is the first-frame and product-identity authority",
	protectedInvariants: ["product geometry", "materials and colors", "existing label and logo"],
	initialState: "hold the supplied composition briefly with the product physically still",
	primaryAction: "a controlled highlight reveals the front material surface",
	secondaryMotion: "one narrow softbox reflection travels from camera-left to camera-right",
	camera: {
		framing: "centered medium-close hero framing",
		movement: "one straight push-in",
		direction: "toward the product optical center",
		speed: "slow with gentle ease-in and ease-out",
		motivation: "reveal surface texture without changing product geometry",
		restPoint: "a stable close hero composition with the existing branding sharp",
	},
	lighting: {
		setup: "controlled studio key and restrained edge light",
		behavior: "background exposure stays constant while the single reflection crosses the surface",
	},
	finalState: "camera fully settled on a clean product frame with a short edit hold",
	audioIntent: "silent beauty shot with no speech",
	constraints: ["no geometry drift", "no new text", "no flicker or camera shake"],
};

describe("video generation prompt plans", () => {
	it("compiles a production plan into an inspectable provider-neutral prompt", () => {
		const prompt = compileVideoPromptPlan(parseVideoPromptPlan(COMPLETE_PLAN), { durationSeconds: 5 });

		expect(prompt).toContain("Reference role: the source image is the first-frame");
		expect(prompt).toContain("Protected invariants: product geometry; materials and colors; existing label and logo.");
		expect(prompt).toContain("Initial state:");
		expect(prompt).toContain("Primary action:");
		expect(prompt).toContain("Camera:");
		expect(prompt).toContain("Final frame:");
		expect(analyzeVideoPromptMethod(prompt)).toEqual([]);
	});

	it("returns stable corrective details for incomplete plans", () => {
		expect(() => parseVideoPromptPlan({
			...COMPLETE_PLAN,
			camera: { movement: "push-in" },
			finalState: "",
		})).toThrow(ContentGenerationPromptPlanError);

		try {
			parseVideoPromptPlan({ ...COMPLETE_PLAN, camera: { movement: "push-in" }, finalState: "" });
			expect.unreachable("expected prompt plan validation to fail");
		} catch (error) {
			expect(error).toMatchObject({
				code: "video-prompt-plan-invalid",
				retryable: true,
				details: {
					missing: expect.arrayContaining(["camera.framing", "camera.restPoint", "finalState"]),
					recommendedSkill: "direct-video-creation",
				},
			});
		}
	});

	it("identifies the weak generic prompt that previously bypassed the workflow", () => {
		const issues = analyzeVideoPromptMethod(
			"Create an independent 5-second premium product-ad shot. Use a slow elegant camera push-in and clean studio lighting.",
		);

		expect(issues).toEqual(expect.arrayContaining([
			"reference-role-missing",
			"initial-state-missing",
			"camera-rest-point-missing",
			"final-frame-missing",
		]));
	});
});
