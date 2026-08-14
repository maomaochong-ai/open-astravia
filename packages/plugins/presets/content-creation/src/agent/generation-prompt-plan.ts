import { listConnectedPromptSources, resolveContentPrompt } from "../node/prompt-sources";
import type { ContentProjectDocument } from "../project/types";
import {
	CONTENT_VIDEO_PROMPT_PLAN_KINDS,
	type ResolvedContentVideoShotStrategy,
} from "./video-shot-methods";
import {
	VIDEO_PROMPT_PLAN_FIELD_GUIDANCE,
	VIDEO_PROMPT_PLAN_SCHEMA,
	type ContentAnimateStillPromptPlan,
	type ContentFirstLastFramePromptPlan,
	type ContentLegacyVideoPromptPlan,
	type ContentOmniReferencePromptPlan,
	type ContentTextToVideoPromptPlan,
	type ContentTransformVideoPromptPlan,
	type ContentVideoPromptPlan,
	type ContentVideoPromptPlanBase,
	videoPromptPlanStrategy,
} from "./video-prompt-plan-contract";

export {
	VIDEO_PROMPT_PLAN_FIELD_GUIDANCE,
	VIDEO_PROMPT_PLAN_SCHEMA,
	type ContentVideoPromptPlan,
	videoPromptPlanStrategy,
} from "./video-prompt-plan-contract";

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
	| "final-frame-missing"
	| "text-world-definition-missing"
	| "source-image-contract-missing"
	| "endpoint-transition-contract-missing"
	| "reference-interaction-contract-missing"
	| "video-transformation-contract-missing";

export class ContentGenerationPromptPlanError extends Error {
	constructor(
		message: string,
		readonly code:
			| "video-prompt-plan-invalid"
			| "video-prompt-method-incomplete"
			| "keyframe-prompt-plan-invalid",
		readonly details: Record<string, unknown>,
		readonly retryable = true,
	) {
		super(message);
	}
}

export function parseVideoPromptPlan(value: unknown): ContentVideoPromptPlan {
	const plan = asRecord(value);
	const kind = optionalString(plan, "kind");
	const { base, missing } = parseBasePlan(plan);
	let parsed: ContentVideoPromptPlan | undefined;

	if (kind === "text-to-video-plan") {
		const world = requiredRecord(plan, "worldDefinition", missing);
		parsed = {
			kind,
			...base,
			worldDefinition: {
				subject: requiredStringAt(world, "subject", "worldDefinition.subject", missing),
				environment: requiredStringAt(world, "environment", "worldDefinition.environment", missing),
				visualStyle: requiredStringAt(world, "visualStyle", "worldDefinition.visualStyle", missing),
			},
		} satisfies ContentTextToVideoPromptPlan;
	} else if (kind === "animate-still-plan") {
		const contract = requiredRecord(plan, "sourceImageContract", missing);
		parsed = {
			kind,
			...base,
			sourceImageContract: {
				authority: requiredStringAt(contract, "authority", "sourceImageContract.authority", missing),
				inherit: requiredStringList(contract.inherit, "sourceImageContract.inherit", missing),
				animate: requiredStringList(contract.animate, "sourceImageContract.animate", missing),
				introduce: stringList(contract.introduce),
			},
		} satisfies ContentAnimateStillPromptPlan;
	} else if (kind === "first-last-frame-plan") {
		const contract = requiredRecord(plan, "transitionContract", missing);
		parsed = {
			kind,
			...base,
			transitionContract: {
				continuity: requiredStringList(contract.continuity, "transitionContract.continuity", missing),
				stateChanges: requiredStringList(contract.stateChanges, "transitionContract.stateChanges", missing),
				physicalPath: requiredStringAt(contract, "physicalPath", "transitionContract.physicalPath", missing),
			},
		} satisfies ContentFirstLastFramePromptPlan;
	} else if (kind === "omni-reference-plan") {
		const interaction = requiredRecord(plan, "referenceInteraction", missing);
		parsed = {
			kind,
			...base,
			referenceInteraction: {
				relationships: requiredStringList(
					interaction.relationships,
					"referenceInteraction.relationships",
					missing,
				),
				chronology: requiredStringList(
					interaction.chronology,
					"referenceInteraction.chronology",
					missing,
				),
			},
		} satisfies ContentOmniReferencePromptPlan;
	} else if (kind === "transform-video-plan") {
		const contract = requiredRecord(plan, "transformationContract", missing);
		parsed = {
			kind,
			...base,
			transformationContract: {
				sourceTimeRange: requiredStringAt(
					contract,
					"sourceTimeRange",
					"transformationContract.sourceTimeRange",
					missing,
				),
				preserve: requiredStringList(contract.preserve, "transformationContract.preserve", missing),
				change: requiredStringList(contract.change, "transformationContract.change", missing),
				temporalMapping: requiredStringAt(
					contract,
					"temporalMapping",
					"transformationContract.temporalMapping",
					missing,
				),
			},
		} satisfies ContentTransformVideoPromptPlan;
	} else if (kind === "video-shot") {
		parsed = { kind, ...base } satisfies ContentLegacyVideoPromptPlan;
	} else {
		missing.unshift("kind");
	}

	if (!parsed || missing.length > 0) {
		throw new ContentGenerationPromptPlanError(
			"video prompt plan is incomplete or does not match a supported strategy",
			"video-prompt-plan-invalid",
			{
				kind: kind ?? null,
				missing: [...new Set(missing)],
				supportedKinds: CONTENT_VIDEO_PROMPT_PLAN_KINDS,
				requiredFields: VIDEO_PROMPT_PLAN_FIELD_GUIDANCE,
				recommendedSkill: "direct-video-creation",
			},
		);
	}
	return parsed;
}

export function compileVideoPromptPlan(
	plan: ContentVideoPromptPlan,
	options: { durationSeconds?: number } = {},
): string {
	return [
		...(plan.kind === "video-shot"
			? []
			: [`Video strategy: ${videoPromptPlanStrategy(plan)}.`, ...compileStrategyContract(plan)]),
		...compileSharedPlan(plan, options.durationSeconds),
	].join("\n");
}

export function analyzeVideoPromptMethod(
	prompt: string,
	strategy?: ResolvedContentVideoShotStrategy,
): ContentVideoPromptMethodIssue[] {
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
	if (strategy === "text-to-video" && !/^World definition:/im.test(prompt)) {
		issues.push("text-world-definition-missing");
	}
	if (strategy === "animate-still" && !/^Source-image authority:/im.test(prompt)) {
		issues.push("source-image-contract-missing");
	}
	if (strategy === "first-last-frame" && !/^Endpoint transition:/im.test(prompt)) {
		issues.push("endpoint-transition-contract-missing");
	}
	if (strategy === "omni-reference" && !/^Reference relationships:/im.test(prompt)) {
		issues.push("reference-interaction-contract-missing");
	}
	if (strategy === "transform-video" && !/^Source-video time scope:/im.test(prompt)) {
		issues.push("video-transformation-contract-missing");
	}
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

function parseBasePlan(plan: Record<string, unknown>): {
	base: ContentVideoPromptPlanBase;
	missing: string[];
} {
	const missing: string[] = [];
	const camera = requiredRecord(plan, "camera", missing);
	const lighting = requiredRecord(plan, "lighting", missing);
	const protectedInvariants = requiredStringList(plan.protectedInvariants, "protectedInvariants", missing);
	const audioIntent = optionalString(plan, "audioIntent");
	return {
		missing,
		base: {
			sceneFunction: requiredStringAt(plan, "sceneFunction", "sceneFunction", missing),
			referenceRole: requiredStringAt(plan, "referenceRole", "referenceRole", missing),
			protectedInvariants,
			initialState: requiredStringAt(plan, "initialState", "initialState", missing),
			primaryAction: requiredStringAt(plan, "primaryAction", "primaryAction", missing),
			secondaryMotion: requiredStringAt(plan, "secondaryMotion", "secondaryMotion", missing),
			camera: {
				framing: requiredStringAt(camera, "framing", "camera.framing", missing),
				movement: requiredStringAt(camera, "movement", "camera.movement", missing),
				direction: requiredStringAt(camera, "direction", "camera.direction", missing),
				speed: requiredStringAt(camera, "speed", "camera.speed", missing),
				motivation: requiredStringAt(camera, "motivation", "camera.motivation", missing),
				restPoint: requiredStringAt(camera, "restPoint", "camera.restPoint", missing),
			},
			lighting: {
				setup: requiredStringAt(lighting, "setup", "lighting.setup", missing),
				behavior: requiredStringAt(lighting, "behavior", "lighting.behavior", missing),
			},
			finalState: requiredStringAt(plan, "finalState", "finalState", missing),
			...(audioIntent ? { audioIntent } : {}),
			constraints: stringList(plan.constraints),
		},
	};
}

function compileStrategyContract(plan: Exclude<ContentVideoPromptPlan, ContentLegacyVideoPromptPlan>): string[] {
	switch (plan.kind) {
		case "text-to-video-plan":
			return [
				`World definition: Subject — ${sentence(plan.worldDefinition.subject)} Environment — ${sentence(plan.worldDefinition.environment)} Visual treatment — ${sentence(plan.worldDefinition.visualStyle)}`,
			];
		case "animate-still-plan":
			return [
				`Source-image authority: ${sentence(plan.sourceImageContract.authority)}`,
				`Inherit unchanged: ${sentence(plan.sourceImageContract.inherit.join("; "))}`,
				`Animate from the still: ${sentence(plan.sourceImageContract.animate.join("; "))}`,
				`New visible elements: ${sentence(plan.sourceImageContract.introduce.length > 0 ? plan.sourceImageContract.introduce.join("; ") : "none")}`,
			];
		case "first-last-frame-plan":
			return [
				`Endpoint transition: Treat the separately generated first and last frames as authoritative frozen endpoints.`,
				`Transition continuity: ${sentence(plan.transitionContract.continuity.join("; "))}`,
				`Required state changes: ${sentence(plan.transitionContract.stateChanges.join("; "))}`,
				`Physical path: ${sentence(plan.transitionContract.physicalPath)}`,
			];
		case "omni-reference-plan":
			return [
				`Reference relationships: ${sentence(plan.referenceInteraction.relationships.join("; "))}`,
				`Choreography chronology: ${sentence(plan.referenceInteraction.chronology.join(" -> "))}`,
			];
		case "transform-video-plan":
			return [
				`Source-video time scope: ${sentence(plan.transformationContract.sourceTimeRange)}`,
				`Preserve from source video: ${sentence(plan.transformationContract.preserve.join("; "))}`,
				`Change from source video: ${sentence(plan.transformationContract.change.join("; "))}`,
				`Temporal mapping: ${sentence(plan.transformationContract.temporalMapping)}`,
			];
	}
}

function compileSharedPlan(plan: ContentVideoPromptPlanBase, durationSeconds?: number): string[] {
	const duration = durationSeconds === undefined
		? "Single coherent shot."
		: `${formatNumber(durationSeconds)}-second single coherent shot.`;
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
	];
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function requiredRecord(
	record: Record<string, unknown>,
	key: string,
	missing: string[],
): Record<string, unknown> {
	const value = record[key];
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	missing.push(key);
	return {};
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredStringAt(
	record: Record<string, unknown>,
	key: string,
	path: string,
	missing: string[],
): string {
	const value = optionalString(record, key);
	if (value) return value;
	missing.push(path);
	return "";
}

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
		: [];
}

function requiredStringList(value: unknown, path: string, missing: string[]): string[] {
	const values = stringList(value);
	if (values.length === 0) missing.push(path);
	return values;
}

function sentence(value: string): string {
	const trimmed = value.trim().replace(/[.\s]+$/g, "");
	return `${trimmed}.`;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
