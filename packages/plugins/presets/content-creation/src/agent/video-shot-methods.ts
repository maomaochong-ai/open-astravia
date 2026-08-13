import type { ContentVideoGenerationIntent } from "../generation/generation-intent";

export const CONTENT_VIDEO_SHOT_STRATEGIES = [
	"automatic",
	"text-to-video",
	"animate-still",
	"first-last-frame",
	"omni-reference",
	"transform-video",
] as const;

export type ContentVideoShotStrategy = (typeof CONTENT_VIDEO_SHOT_STRATEGIES)[number];
export type ResolvedContentVideoShotStrategy = Exclude<ContentVideoShotStrategy, "automatic">;

export const CONTENT_VIDEO_PROMPT_PLAN_KINDS = [
	"text-to-video-plan",
	"animate-still-plan",
	"first-last-frame-plan",
	"omni-reference-plan",
	"transform-video-plan",
] as const;

export type ContentVideoPromptPlanKind = (typeof CONTENT_VIDEO_PROMPT_PLAN_KINDS)[number];

export interface ContentVideoShotMethodDefinition {
	strategy: ResolvedContentVideoShotStrategy;
	promptPlanKind: ContentVideoPromptPlanKind;
	generationIntent: ContentVideoGenerationIntent;
	description: string;
	inputContract: string;
}

export const CONTENT_VIDEO_SHOT_METHODS: Readonly<
	Record<ResolvedContentVideoShotStrategy, ContentVideoShotMethodDefinition>
> = {
	"text-to-video": {
		strategy: "text-to-video",
		promptPlanKind: "text-to-video-plan",
		generationIntent: "text-to-video",
		description: "Build the complete visible world and motion from text when no supplied media must be authoritative.",
		inputContract: "No media sources or keyframes.",
	},
	"animate-still": {
		strategy: "animate-still",
		promptPlanKind: "animate-still-plan",
		generationIntent: "animate-still",
		description: "Animate one authoritative still while preserving its identity, composition, materials, and lighting.",
		inputContract: "Exactly one image authority, supplied as one source or keyframes.first.",
	},
	"first-last-frame": {
		strategy: "first-last-frame",
		promptPlanKind: "first-last-frame-plan",
		generationIntent: "interpolate-frames",
		description: "Design two authoritative static endpoints and direct one physically coherent transition between them.",
		inputContract: "Distinct keyframes.first and keyframes.last plans with one shared aspect ratio.",
	},
	"omni-reference": {
		strategy: "omni-reference",
		promptPlanKind: "omni-reference-plan",
		generationIntent: "reference-guided",
		description: "Coordinate several identity, product, environment, style, motion, or audio authorities by explicit role.",
		inputContract: "One or more aliased semantic sources; add an environment authority when scene control is required.",
	},
	"transform-video": {
		strategy: "transform-video",
		promptPlanKind: "transform-video-plan",
		generationIntent: "transform-video",
		description: "Transform one source video with an explicit time scope, preserve list, change list, and temporal mapping.",
		inputContract: "Exactly one video source.",
	},
};

const STRATEGY_BY_PROMPT_PLAN_KIND = new Map<ContentVideoPromptPlanKind, ResolvedContentVideoShotStrategy>(
	Object.values(CONTENT_VIDEO_SHOT_METHODS).map((method) => [method.promptPlanKind, method.strategy]),
);

export function contentVideoShotMethod(
	strategy: ResolvedContentVideoShotStrategy,
): ContentVideoShotMethodDefinition {
	return CONTENT_VIDEO_SHOT_METHODS[strategy];
}

export function contentVideoShotStrategyForPromptPlanKind(
	kind: string,
): ResolvedContentVideoShotStrategy | undefined {
	return STRATEGY_BY_PROMPT_PLAN_KIND.get(kind as ContentVideoPromptPlanKind);
}

export function contentVideoShotStrategyDescription(): string {
	return Object.values(CONTENT_VIDEO_SHOT_METHODS)
		.map((method) => `${method.strategy}: ${method.description} ${method.inputContract}`)
		.join("\n");
}

export function inferContentVideoShotStrategy(
	modeId: string | undefined,
	sourceRoles: readonly string[],
): ResolvedContentVideoShotStrategy | undefined {
	if (modeId === "reference-to-video") return "omni-reference";
	if (modeId === "video-to-video") return "transform-video";
	if (modeId === "image-to-video") {
		return sourceRoles.includes("lastFrame") ? "first-last-frame" : "animate-still";
	}
	if (modeId === "text-to-video") return "text-to-video";
	return undefined;
}
