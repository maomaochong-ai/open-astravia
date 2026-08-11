import { ContentGenerationPromptPlanError } from "./generation-prompt-plan";

export const KEYFRAME_PROMPT_PLAN_SCHEMA = {
	type: "object",
	description:
		"Static image plan for the first or last frame of a video shot. Describe only the visible frozen state; motion belongs in the video prompt plan.",
	properties: {
		kind: { type: "string", enum: ["image-keyframe"] },
		phase: { type: "string", enum: ["first", "last"] },
		sceneFunction: { type: "string" },
		referenceRole: { type: "string" },
		protectedInvariants: { type: "array", items: { type: "string" } },
		visibleState: { type: "string" },
		composition: {
			type: "object",
			properties: {
				framing: { type: "string" },
				angle: { type: "string" },
				placement: { type: "string" },
				cameraAxis: { type: "string" },
			},
			additionalProperties: false,
		},
		environment: { type: "string" },
		lighting: {
			type: "object",
			properties: {
				setup: { type: "string" },
				direction: { type: "string" },
			},
			additionalProperties: false,
		},
		style: { type: "string" },
		constraints: { type: "array", items: { type: "string" } },
	},
	additionalProperties: false,
} as const;

export interface ContentKeyframePromptPlan {
	kind: "image-keyframe";
	phase: "first" | "last";
	sceneFunction: string;
	referenceRole: string;
	protectedInvariants: string[];
	visibleState: string;
	composition: {
		framing: string;
		angle: string;
		placement: string;
		cameraAxis: string;
	};
	environment: string;
	lighting: {
		setup: string;
		direction: string;
	};
	style: string;
	constraints: string[];
}

export function parseKeyframePromptPlan(value: unknown): ContentKeyframePromptPlan {
	const plan = record(value);
	const composition = record(plan.composition);
	const lighting = record(plan.lighting);
	const invariants = strings(plan.protectedInvariants);
	const missing = [
		...literalMissing(plan, "kind", "image-keyframe"),
		...enumMissing(plan, "phase", ["first", "last"]),
		...stringMissing(plan, "sceneFunction"),
		...stringMissing(plan, "referenceRole"),
		...(invariants.length > 0 ? [] : ["protectedInvariants"]),
		...stringMissing(plan, "visibleState"),
		...nestedStringMissing(composition, "composition", "framing"),
		...nestedStringMissing(composition, "composition", "angle"),
		...nestedStringMissing(composition, "composition", "placement"),
		...nestedStringMissing(composition, "composition", "cameraAxis"),
		...stringMissing(plan, "environment"),
		...nestedStringMissing(lighting, "lighting", "setup"),
		...nestedStringMissing(lighting, "lighting", "direction"),
		...stringMissing(plan, "style"),
	];
	if (missing.length > 0) {
		throw new ContentGenerationPromptPlanError(
			"keyframe prompt plan is incomplete",
			"keyframe-prompt-plan-invalid",
			{ missing, recommendedSkill: "direct-image-creation" },
		);
	}
	return {
		kind: "image-keyframe",
		phase: required(plan, "phase") as "first" | "last",
		sceneFunction: required(plan, "sceneFunction"),
		referenceRole: required(plan, "referenceRole"),
		protectedInvariants: invariants,
		visibleState: required(plan, "visibleState"),
		composition: {
			framing: required(composition, "framing"),
			angle: required(composition, "angle"),
			placement: required(composition, "placement"),
			cameraAxis: required(composition, "cameraAxis"),
		},
		environment: required(plan, "environment"),
		lighting: {
			setup: required(lighting, "setup"),
			direction: required(lighting, "direction"),
		},
		style: required(plan, "style"),
		constraints: strings(plan.constraints),
	};
}

export function compileKeyframePromptPlan(plan: ContentKeyframePromptPlan): string {
	return [
		`Keyframe phase: ${plan.phase} frame.`,
		`Scene function: ${sentence(plan.sceneFunction)}`,
		`Reference role: ${sentence(plan.referenceRole)}`,
		`Protected invariants: ${sentence(plan.protectedInvariants.join("; "))}`,
		`Frozen visible state: ${sentence(plan.visibleState)}`,
		`Composition: ${sentence(`${plan.composition.framing}; ${plan.composition.angle}; ${plan.composition.placement}`)}`,
		`Camera axis: ${sentence(plan.composition.cameraAxis)}`,
		`Environment: ${sentence(plan.environment)}`,
		`Lighting: ${sentence(`${plan.lighting.setup}; light direction ${plan.lighting.direction}`)}`,
		`Style and finish: ${sentence(plan.style)}`,
		...(plan.constraints.length > 0 ? [`Constraints: ${sentence(plan.constraints.join("; "))}`] : []),
	].join("\n");
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function optional(recordValue: Record<string, unknown>, key: string): string | undefined {
	const value = recordValue[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function required(recordValue: Record<string, unknown>, key: string): string {
	const value = optional(recordValue, key);
	if (!value) throw new Error(`${key} is required`);
	return value;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
		: [];
}

function stringMissing(value: Record<string, unknown>, key: string): string[] {
	return optional(value, key) ? [] : [key];
}

function nestedStringMissing(value: Record<string, unknown>, parent: string, key: string): string[] {
	return optional(value, key) ? [] : [`${parent}.${key}`];
}

function literalMissing(value: Record<string, unknown>, key: string, expected: string): string[] {
	return value[key] === expected ? [] : [key];
}

function enumMissing(value: Record<string, unknown>, key: string, expected: readonly string[]): string[] {
	return typeof value[key] === "string" && expected.includes(value[key]) ? [] : [key];
}

function sentence(value: string): string {
	return `${value.trim().replace(/[.\s]+$/g, "")}.`;
}
