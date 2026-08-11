import { listConnectedPromptSources, resolveContentPrompt } from "../node/prompt-sources";
import type { ContentProjectDocument } from "../project/types";

export const VIDEO_PROMPT_PLAN_SCHEMA = {
	type: "object",
	description:
		"Structured production plan for a video prompt. Prefer this over a raw prompt; the plugin compiles it into provider-neutral directing language and validates the effective video prompt.",
	properties: {
		kind: { type: "string", enum: ["video-shot"] },
		sceneFunction: { type: "string" },
		referenceRole: { type: "string" },
		protectedInvariants: { type: "array", items: { type: "string" } },
		initialState: { type: "string" },
		primaryAction: { type: "string" },
		secondaryMotion: { type: "string" },
		camera: {
			type: "object",
			properties: {
				framing: { type: "string" },
				movement: { type: "string" },
				direction: { type: "string" },
				speed: { type: "string" },
				motivation: { type: "string" },
				restPoint: { type: "string" },
			},
			additionalProperties: false,
		},
		lighting: {
			type: "object",
			properties: {
				setup: { type: "string" },
				behavior: { type: "string" },
			},
			additionalProperties: false,
		},
		finalState: { type: "string" },
		audioIntent: { type: "string" },
		constraints: { type: "array", items: { type: "string" } },
	},
	additionalProperties: false,
} as const;

export const VIDEO_PROMPT_PLAN_FIELD_GUIDANCE = [
	"sceneFunction",
	"referenceRole",
	"protectedInvariants[]",
	"initialState",
	"primaryAction",
	"secondaryMotion",
	"camera.{framing,movement,direction,speed,motivation,restPoint}",
	"lighting.{setup,behavior}",
	"finalState",
	"optional audioIntent",
	"optional constraints[]",
].join(", ");

export interface ContentVideoPromptPlan {
	kind: "video-shot";
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
	lighting: {
		setup: string;
		behavior: string;
	};
	finalState: string;
	audioIntent?: string;
	constraints: string[];
}

export type ContentVideoPromptMethodIssue =
	| "reference-role-missing"
	| "protected-invariants-missing"
	| "initial-state-missing"
	| "primary-action-missing"
	| "secondary-motion-missing"
	| "camera-direction-missing"
	| "camera-motivation-missing"
	| "camera-rest-point-missing"
	| "lighting-behavior-missing"
	| "final-frame-missing";

export class ContentGenerationPromptPlanError extends Error {
	constructor(
		message: string,
		readonly code: "video-prompt-plan-invalid" | "video-prompt-method-incomplete",
		readonly details: Record<string, unknown>,
		readonly retryable = true,
	) {
		super(message);
	}
}

export function parseVideoPromptPlan(value: unknown): ContentVideoPromptPlan {
	const plan = asRecord(value);
	const camera = optionalRecord(plan.camera);
	const lighting = optionalRecord(plan.lighting);
	const protectedInvariants = stringArray(plan.protectedInvariants);
	const constraints = stringArray(plan.constraints, true);
	const missing = [
		...missingLiteral(plan, "kind", "video-shot"),
		...missingString(plan, "sceneFunction"),
		...missingString(plan, "referenceRole"),
		...(protectedInvariants.length === 0 ? ["protectedInvariants"] : []),
		...missingString(plan, "initialState"),
		...missingString(plan, "primaryAction"),
		...missingString(plan, "secondaryMotion"),
		...missingNestedString(camera, "camera", "framing"),
		...missingNestedString(camera, "camera", "movement"),
		...missingNestedString(camera, "camera", "direction"),
		...missingNestedString(camera, "camera", "speed"),
		...missingNestedString(camera, "camera", "motivation"),
		...missingNestedString(camera, "camera", "restPoint"),
		...missingNestedString(lighting, "lighting", "setup"),
		...missingNestedString(lighting, "lighting", "behavior"),
		...missingString(plan, "finalState"),
	];
	if (missing.length > 0) {
		throw new ContentGenerationPromptPlanError(
			"video prompt plan is incomplete",
			"video-prompt-plan-invalid",
			{
				missing,
				requiredFields: VIDEO_PROMPT_PLAN_FIELD_GUIDANCE,
				recommendedSkill: "direct-video-creation",
			},
		);
	}
	const audioIntent = optionalString(plan, "audioIntent");
	return {
		kind: "video-shot",
		sceneFunction: requiredString(plan, "sceneFunction"),
		referenceRole: requiredString(plan, "referenceRole"),
		protectedInvariants,
		initialState: requiredString(plan, "initialState"),
		primaryAction: requiredString(plan, "primaryAction"),
		secondaryMotion: requiredString(plan, "secondaryMotion"),
		camera: {
			framing: requiredString(camera, "framing"),
			movement: requiredString(camera, "movement"),
			direction: requiredString(camera, "direction"),
			speed: requiredString(camera, "speed"),
			motivation: requiredString(camera, "motivation"),
			restPoint: requiredString(camera, "restPoint"),
		},
		lighting: {
			setup: requiredString(lighting, "setup"),
			behavior: requiredString(lighting, "behavior"),
		},
		finalState: requiredString(plan, "finalState"),
		...(audioIntent ? { audioIntent } : {}),
		constraints,
	};
}

export function compileVideoPromptPlan(
	plan: ContentVideoPromptPlan,
	options: { durationSeconds?: number } = {},
): string {
	const duration = options.durationSeconds === undefined
		? "Single coherent shot."
		: `${formatNumber(options.durationSeconds)}-second single coherent shot.`;
	return [
		`Scene function: ${sentence(plan.sceneFunction)}`,
		`Reference role: ${sentence(plan.referenceRole)}`,
		`Protected invariants: ${sentence(plan.protectedInvariants.join("; "))}`,
		`${duration} Initial state: ${sentence(plan.initialState)}`,
		`Primary action: ${sentence(plan.primaryAction)} Secondary motion: ${sentence(plan.secondaryMotion)}`,
		`Camera: ${sentence(plan.camera.framing)} Use ${plan.camera.movement}, moving ${plan.camera.direction}, ${plan.camera.speed}; motivated by ${plan.camera.motivation}; the camera rests at ${sentence(plan.camera.restPoint)}`,
		`Lighting: ${sentence(plan.lighting.setup)} Light behavior: ${sentence(plan.lighting.behavior)}`,
		...(plan.audioIntent ? [`Audio intent: ${sentence(plan.audioIntent)}`] : []),
		`Final frame: ${sentence(plan.finalState)}`,
		...(plan.constraints.length > 0 ? [`Constraints: ${sentence(plan.constraints.join("; "))}`] : []),
	].join("\n");
}

export function analyzeVideoPromptMethod(prompt: string): ContentVideoPromptMethodIssue[] {
	const issues: ContentVideoPromptMethodIssue[] = [];
	if (!/\breference role\s*:/i.test(prompt)) issues.push("reference-role-missing");
	if (!/\bprotected invariants\s*:/i.test(prompt)) issues.push("protected-invariants-missing");
	if (!/\binitial state\s*:/i.test(prompt)) issues.push("initial-state-missing");
	if (!/\bprimary action\s*:/i.test(prompt)) issues.push("primary-action-missing");
	if (!/\bsecondary motion\s*:/i.test(prompt)) issues.push("secondary-motion-missing");
	if (!/\bcamera\s*:/i.test(prompt) || !/\bmoving\b/i.test(prompt)) issues.push("camera-direction-missing");
	if (!/\bmotivated by\b/i.test(prompt)) issues.push("camera-motivation-missing");
	if (!/\bcamera rests at\b/i.test(prompt)) issues.push("camera-rest-point-missing");
	if (!/\blighting\s*:/i.test(prompt) || !/\blight behavior\s*:/i.test(prompt)) {
		issues.push("lighting-behavior-missing");
	}
	if (!/\bfinal frame\s*:/i.test(prompt)) issues.push("final-frame-missing");
	return issues;
}

export function assertChangedVideoPromptsUseProductionMethod(
	before: ContentProjectDocument,
	after: ContentProjectDocument,
): void {
	for (const node of after.graph.nodes) {
		if (node.kind !== "video-generator") continue;
		const previousNode = before.graph.nodes.find((candidate) => candidate.id === node.id);
		const previousPrompt = previousNode
			? resolveContentPrompt(listConnectedPromptSources(before, previousNode.id), previousNode.data)
			: "";
		const nextPrompt = resolveContentPrompt(listConnectedPromptSources(after, node.id), node.data);
		if (!nextPrompt || nextPrompt === previousPrompt) continue;
		const issues = analyzeVideoPromptMethod(nextPrompt);
		if (issues.length === 0) continue;
		throw new ContentGenerationPromptPlanError(
			"Agent-authored video prompt does not satisfy the production method",
			"video-prompt-method-incomplete",
			{
				nodeId: node.id,
				issues,
				requiredFields: VIDEO_PROMPT_PLAN_FIELD_GUIDANCE,
				recommendedSkill: "direct-video-creation",
				recommendedOperationField: "promptPlan",
			},
		);
	}
}

function sentence(value: string): string {
	const trimmed = value.trim().replace(/[.\s]+$/g, "");
	return `${trimmed}.`;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function optionalRecord(value: unknown): Record<string, unknown> {
	return asRecord(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = optionalString(record, key);
	if (!value) throw new Error(`${key} is required`);
	return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, optional = false): string[] {
	if (value === undefined && optional) return [];
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
}

function missingString(record: Record<string, unknown>, key: string): string[] {
	return optionalString(record, key) ? [] : [key];
}

function missingNestedString(record: Record<string, unknown>, parent: string, key: string): string[] {
	return optionalString(record, key) ? [] : [`${parent}.${key}`];
}

function missingLiteral(record: Record<string, unknown>, key: string, literal: string): string[] {
	return record[key] === literal ? [] : [key];
}
