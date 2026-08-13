import type {
	ContentVideoPromptPlanKind,
	ResolvedContentVideoShotStrategy,
} from "./video-shot-methods";

const STRING = { type: "string", minLength: 1 } as const;
const STRING_LIST = { type: "array", items: STRING } as const;
const NON_EMPTY_STRING_LIST = { ...STRING_LIST, minItems: 1 } as const;

const CAMERA_SCHEMA = {
	type: "object",
	properties: {
		framing: STRING,
		movement: STRING,
		direction: STRING,
		speed: STRING,
		motivation: STRING,
		restPoint: STRING,
	},
	required: ["framing", "movement", "direction", "speed", "motivation", "restPoint"],
	additionalProperties: false,
} as const;

const LIGHTING_SCHEMA = {
	type: "object",
	properties: { setup: STRING, behavior: STRING },
	required: ["setup", "behavior"],
	additionalProperties: false,
} as const;

const COMMON_PROPERTIES = {
	sceneFunction: { ...STRING, description: "What this shot contributes to the final edit or story." },
	referenceRole: { ...STRING, description: "Which input or written description is authoritative, and for what." },
	protectedInvariants: {
		...NON_EMPTY_STRING_LIST,
		description: "Visible facts that must not drift during the shot.",
	},
	initialState: { ...STRING, description: "The visible state at the first instant of the video." },
	primaryAction: { ...STRING, description: "The principal continuous state change, written as observable motion." },
	secondaryMotion: { ...STRING, description: "One subordinate physical response that supports the primary action." },
	camera: CAMERA_SCHEMA,
	lighting: LIGHTING_SCHEMA,
	finalState: { ...STRING, description: "The readable visible state after motion resolves." },
	audioIntent: { type: "string" },
	constraints: STRING_LIST,
} as const;

const COMMON_REQUIRED = [
	"sceneFunction",
	"referenceRole",
	"protectedInvariants",
	"initialState",
	"primaryAction",
	"secondaryMotion",
	"camera",
	"lighting",
	"finalState",
	"constraints",
] as const;

function planVariant(
	kind: ContentVideoPromptPlanKind,
	description: string,
	properties: Record<string, unknown>,
	required: readonly string[],
) {
	return {
		type: "object",
		description,
		properties: { kind: { const: kind }, ...COMMON_PROPERTIES, ...properties },
		required: ["kind", ...COMMON_REQUIRED, ...required],
		additionalProperties: false,
	} as const;
}

const TEXT_TO_VIDEO_PLAN_SCHEMA = planVariant(
	"text-to-video-plan",
	"Create the complete visible world from text. Define subject, environment, and visual treatment instead of referring to an absent source image.",
	{
		worldDefinition: {
			type: "object",
			properties: { subject: STRING, environment: STRING, visualStyle: STRING },
			required: ["subject", "environment", "visualStyle"],
			additionalProperties: false,
		},
	},
	["worldDefinition"],
);

const ANIMATE_STILL_PLAN_SCHEMA = planVariant(
	"animate-still-plan",
	"Animate one authoritative still. Separate what must be inherited from what is allowed to move, change, or enter the frame.",
	{
		sourceImageContract: {
			type: "object",
			properties: {
				authority: STRING,
				inherit: NON_EMPTY_STRING_LIST,
				animate: NON_EMPTY_STRING_LIST,
				introduce: STRING_LIST,
			},
			required: ["authority", "inherit", "animate", "introduce"],
			additionalProperties: false,
		},
	},
	["sourceImageContract"],
);

const FIRST_LAST_FRAME_PLAN_SCHEMA = planVariant(
	"first-last-frame-plan",
	"Direct the continuous motion between two separately authored static endpoint frames. Describe transition physics, not either frozen image prompt.",
	{
		transitionContract: {
			type: "object",
			properties: {
				continuity: NON_EMPTY_STRING_LIST,
				stateChanges: NON_EMPTY_STRING_LIST,
				physicalPath: STRING,
			},
			required: ["continuity", "stateChanges", "physicalPath"],
			additionalProperties: false,
		},
	},
	["transitionContract"],
);

const OMNI_REFERENCE_PLAN_SCHEMA = planVariant(
	"omni-reference-plan",
	"Coordinate multiple semantic references. Explain how their authorities interact and provide an ordered choreography the model can resolve.",
	{
		referenceInteraction: {
			type: "object",
			properties: {
				relationships: NON_EMPTY_STRING_LIST,
				chronology: NON_EMPTY_STRING_LIST,
			},
			required: ["relationships", "chronology"],
			additionalProperties: false,
		},
	},
	["referenceInteraction"],
);

const TRANSFORM_VIDEO_PLAN_SCHEMA = planVariant(
	"transform-video-plan",
	"Transform one source video. Bound the affected time range and state exactly what temporal structure is preserved and changed.",
	{
		transformationContract: {
			type: "object",
			properties: {
				sourceTimeRange: STRING,
				preserve: NON_EMPTY_STRING_LIST,
				change: NON_EMPTY_STRING_LIST,
				temporalMapping: STRING,
			},
			required: ["sourceTimeRange", "preserve", "change", "temporalMapping"],
			additionalProperties: false,
		},
	},
	["transformationContract"],
);

export const VIDEO_PROMPT_PLAN_SCHEMA = {
	description:
		"Strategy-specific production plan for one video shot. Choose the plan kind that matches the intended generation strategy; each kind carries a different creative contract.",
	oneOf: [
		TEXT_TO_VIDEO_PLAN_SCHEMA,
		ANIMATE_STILL_PLAN_SCHEMA,
		FIRST_LAST_FRAME_PLAN_SCHEMA,
		OMNI_REFERENCE_PLAN_SCHEMA,
		TRANSFORM_VIDEO_PLAN_SCHEMA,
	],
} as const;

export const VIDEO_PROMPT_PLAN_FIELD_GUIDANCE = [
	"shared: sceneFunction, referenceRole, protectedInvariants[], initialState, primaryAction, secondaryMotion, camera, lighting, finalState, constraints[]",
	"text-to-video-plan: worldDefinition.{subject,environment,visualStyle}",
	"animate-still-plan: sourceImageContract.{authority,inherit[],animate[],introduce[]}",
	"first-last-frame-plan: transitionContract.{continuity[],stateChanges[],physicalPath}",
	"omni-reference-plan: referenceInteraction.{relationships[],chronology[]}",
	"transform-video-plan: transformationContract.{sourceTimeRange,preserve[],change[],temporalMapping}",
].join("; ");

export interface ContentVideoPromptPlanBase {
	sceneFunction: string;
	referenceRole: string;
	protectedInvariants: string[];
	initialState: string;
	primaryAction: string;
	secondaryMotion: string;
	camera: {
		framing: string;
		movement: string;
		direction: string;
		speed: string;
		motivation: string;
		restPoint: string;
	};
	lighting: { setup: string; behavior: string };
	finalState: string;
	audioIntent?: string;
	constraints: string[];
}

export interface ContentTextToVideoPromptPlan extends ContentVideoPromptPlanBase {
	kind: "text-to-video-plan";
	worldDefinition: { subject: string; environment: string; visualStyle: string };
}

export interface ContentAnimateStillPromptPlan extends ContentVideoPromptPlanBase {
	kind: "animate-still-plan";
	sourceImageContract: { authority: string; inherit: string[]; animate: string[]; introduce: string[] };
}

export interface ContentFirstLastFramePromptPlan extends ContentVideoPromptPlanBase {
	kind: "first-last-frame-plan";
	transitionContract: { continuity: string[]; stateChanges: string[]; physicalPath: string };
}

export interface ContentOmniReferencePromptPlan extends ContentVideoPromptPlanBase {
	kind: "omni-reference-plan";
	referenceInteraction: { relationships: string[]; chronology: string[] };
}

export interface ContentTransformVideoPromptPlan extends ContentVideoPromptPlanBase {
	kind: "transform-video-plan";
	transformationContract: {
		sourceTimeRange: string;
		preserve: string[];
		change: string[];
		temporalMapping: string;
	};
}

export interface ContentLegacyVideoPromptPlan extends ContentVideoPromptPlanBase {
	kind: "video-shot";
}

export type ContentSpecializedVideoPromptPlan =
	| ContentTextToVideoPromptPlan
	| ContentAnimateStillPromptPlan
	| ContentFirstLastFramePromptPlan
	| ContentOmniReferencePromptPlan
	| ContentTransformVideoPromptPlan;

export type ContentVideoPromptPlan = ContentSpecializedVideoPromptPlan | ContentLegacyVideoPromptPlan;

export function videoPromptPlanStrategy(
	plan: ContentVideoPromptPlan,
): ResolvedContentVideoShotStrategy | undefined {
	switch (plan.kind) {
		case "text-to-video-plan": return "text-to-video";
		case "animate-still-plan": return "animate-still";
		case "first-last-frame-plan": return "first-last-frame";
		case "omni-reference-plan": return "omni-reference";
		case "transform-video-plan": return "transform-video";
		case "video-shot": return undefined;
	}
}
