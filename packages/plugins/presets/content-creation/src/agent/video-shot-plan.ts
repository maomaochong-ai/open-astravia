import type { ContentReferenceKind } from "../generation/types";
import type {
	ContentVideoShotStrategy,
	ResolvedContentVideoShotStrategy,
} from "./video-shot-methods";

export {
	CONTENT_VIDEO_SHOT_STRATEGIES,
	type ContentVideoShotStrategy,
	type ResolvedContentVideoShotStrategy,
} from "./video-shot-methods";

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

export interface ContentVideoShotStrategyDecision {
	strategy: ResolvedContentVideoShotStrategy;
	reason: string;
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
	return resolveContentVideoShotStrategy(input).strategy;
}

export function resolveContentVideoShotStrategy(
	input: ContentVideoShotStrategyInput,
): ContentVideoShotStrategyDecision {
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
	if (requestedStrategy !== "automatic") {
		return { strategy: requestedStrategy, reason: "The operation explicitly requested this strategy." };
	}
	if (controlRequirements.exactEnding || hasLastFramePlan) {
		return { strategy: "first-last-frame", reason: "The ending must be controlled by an authoritative last frame." };
	}
	const semanticRoles = new Set(sources.flatMap(({ semanticRole }) => semanticRole ? [semanticRole] : []));
	const hasOmniSignal =
		controlRequirements.requiresSceneReference ||
		sources.length > 1 ||
		semanticRoles.size > 1 ||
		semanticRoles.has("environment") ||
		semanticRoles.has("motion") ||
		semanticRoles.has("audio");
	if (hasOmniSignal) {
		return { strategy: "omni-reference", reason: "Several independent media authorities must control the shot." };
	}
	if (sources.length === 1 && sources[0]?.kind === "video") {
		return { strategy: "transform-video", reason: "One source video is the temporal authority." };
	}
	if (sources.length === 1 && sources[0]?.kind === "image") {
		return { strategy: "animate-still", reason: "One source image is the opening and visual authority." };
	}
	if (sources.length === 0 && hasFirstFramePlan && !hasLastFramePlan) {
		return { strategy: "animate-still", reason: "One generated first frame is the opening authority." };
	}
	if (sources.length === 0 && !hasFirstFramePlan && !hasLastFramePlan) {
		return { strategy: "text-to-video", reason: "No external media needs to be authoritative." };
	}
	throw new ContentVideoShotPlanError(
		"video shot requirements do not map to one unambiguous generation strategy",
		"video-shot-strategy-ambiguous",
		{ sourceKinds: sources.map(({ kind }) => kind) },
	);
}
