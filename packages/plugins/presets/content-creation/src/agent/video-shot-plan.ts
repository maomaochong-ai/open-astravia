import type { ContentReferenceKind } from "../generation/types";

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

export const CONTENT_VIDEO_REFERENCE_SEMANTIC_ROLES = [
	"identity",
	"product",
	"environment",
	"style",
	"composition",
	"end",
	"motion",
	"audio",
] as const;

export type ContentVideoReferenceSemanticRole = (typeof CONTENT_VIDEO_REFERENCE_SEMANTIC_ROLES)[number];

export interface ContentVideoShotControlRequirements {
	exactOpening?: boolean;
	exactEnding?: boolean;
	requiresSceneReference?: boolean;
}

export interface ContentVideoShotSourceShape {
	kind: ContentReferenceKind;
	semanticRole?: ContentVideoReferenceSemanticRole;
}

export interface ContentVideoShotStrategyInput {
	requestedStrategy: ContentVideoShotStrategy;
	controlRequirements: ContentVideoShotControlRequirements;
	hasFirstFramePlan: boolean;
	hasLastFramePlan: boolean;
	sources: readonly ContentVideoShotSourceShape[];
}

export class ContentVideoShotPlanError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly details: Record<string, unknown>,
		readonly retryable = true,
	) {
		super(message);
	}
}

export function selectContentVideoShotStrategy(
	input: ContentVideoShotStrategyInput,
): ResolvedContentVideoShotStrategy {
	const { requestedStrategy, controlRequirements, hasFirstFramePlan, hasLastFramePlan, sources } = input;
	if (
		requestedStrategy !== "automatic" &&
		requestedStrategy !== "first-last-frame" &&
		(controlRequirements.exactEnding || hasLastFramePlan)
	) {
		throw new ContentVideoShotPlanError(
			`${requestedStrategy} cannot satisfy an exact final-frame requirement`,
			"video-shot-strategy-conflict",
			{ requestedStrategy, recommendedStrategy: "first-last-frame" },
		);
	}
	if (
		controlRequirements.exactOpening &&
		!hasFirstFramePlan &&
		!sources.some(({ kind }) => kind === "image")
	) {
		throw new ContentVideoShotPlanError(
			"an exact opening requires an image authority or first keyframe plan",
			"video-shot-opening-authority-required",
			{ recommendedSourceKind: "image", recommendedKeyframe: "keyframes.first" },
		);
	}
	if (requestedStrategy !== "automatic") return requestedStrategy;
	if (controlRequirements.exactEnding || hasLastFramePlan) return "first-last-frame";
	const semanticRoles = new Set(sources.flatMap(({ semanticRole }) => semanticRole ? [semanticRole] : []));
	const hasOmniSignal =
		controlRequirements.requiresSceneReference ||
		sources.length > 1 ||
		semanticRoles.size > 1 ||
		semanticRoles.has("environment") ||
		semanticRoles.has("motion") ||
		semanticRoles.has("audio");
	if (hasOmniSignal) return "omni-reference";
	if (sources.length === 1 && sources[0]?.kind === "video") return "transform-video";
	if (sources.length === 1 && sources[0]?.kind === "image") return "animate-still";
	if (sources.length === 0 && hasFirstFramePlan && !hasLastFramePlan) return "animate-still";
	if (sources.length === 0 && !hasFirstFramePlan && !hasLastFramePlan) return "text-to-video";
	throw new ContentVideoShotPlanError(
		"video shot requirements do not map to one unambiguous generation strategy",
		"video-shot-strategy-ambiguous",
		{ sourceKinds: sources.map(({ kind }) => kind) },
	);
}
