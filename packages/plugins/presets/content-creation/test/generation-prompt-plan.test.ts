import { describe, expect, it } from "vitest";
import {
	ContentGenerationPromptPlanError,
	analyzeVideoPromptMethod,
	compileVideoPromptPlan,
	parseVideoPromptPlan,
} from "../src/agent/generation-prompt-plan";

const COMPLETE_PLAN = {
	kind: "animate-still-plan",
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
	sourceImageContract: {
		authority: "the supplied product image controls identity, geometry, materials, and opening composition",
		inherit: ["product geometry", "label", "studio composition"],
		animate: ["one highlight crossing the surface", "one camera push-in"],
		introduce: [],
	},
};

describe("video generation prompt plans", () => {
	it("compiles a production plan into an inspectable provider-neutral prompt", () => {
		const prompt = compileVideoPromptPlan(parseVideoPromptPlan(COMPLETE_PLAN), { durationSeconds: 5 });

		expect(prompt).toContain("Reference role: the source image is the first-frame");
		expect(prompt).toContain("Video strategy: animate-still.");
		expect(prompt).toContain("Source-image authority:");
		expect(prompt).toContain("Protected invariants: product geometry; materials and colors; existing label and logo.");
		expect(prompt).toContain("Initial state:");
		expect(prompt).toContain("Primary action:");
		expect(prompt).toContain("Camera:");
		expect(prompt).toContain("Final frame:");
		expect(analyzeVideoPromptMethod(prompt)).toEqual([]);
	});

	it.each([
		[
			"text-to-video-plan",
			{ worldDefinition: { subject: "A red robot", environment: "A wet night street", visualStyle: "Natural cinema" } },
			"World definition:",
		],
		[
			"first-last-frame-plan",
			{
				transitionContract: {
					continuity: ["same product and studio"],
					stateChanges: ["move from wide to close framing"],
					physicalPath: "the camera follows one straight path while the product remains fixed",
				},
			},
			"Endpoint transition:",
		],
		[
			"omni-reference-plan",
			{
				referenceInteraction: {
					relationships: ["the product remains inside the referenced studio"],
					chronology: ["establish the studio", "reveal the product"],
				},
			},
			"Reference relationships:",
		],
		[
			"transform-video-plan",
			{
				transformationContract: {
					sourceTimeRange: "the full five-second source",
					preserve: ["camera path", "product motion"],
					change: ["replace the background with a dark studio"],
					temporalMapping: "the replacement follows every original frame and occlusion",
				},
			},
			"Source-video time scope:",
		],
	] as const)("compiles the %s strategy through its own method contract", (kind, extension, marker) => {
		const prompt = compileVideoPromptPlan(parseVideoPromptPlan({
			...COMPLETE_PLAN,
			kind,
			sourceImageContract: undefined,
			...extension,
		}));

		expect(prompt).toContain(marker);
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

	it("keeps legacy video-shot plans parseable without advertising them in the Agent schema", () => {
		const plan = parseVideoPromptPlan({ ...COMPLETE_PLAN, kind: "video-shot", sourceImageContract: undefined });

		expect(plan.kind).toBe("video-shot");
		expect(compileVideoPromptPlan(plan)).not.toContain("Video strategy:");
	});
});
