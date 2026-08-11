import {
	ContentGenerationIntentError,
	planContentVideoGeneration,
	type ContentGenerationSourceSpec,
	type ContentVideoGenerationIntent,
} from "../generation/generation-intent";
import type { ContentModelDescriptor } from "../generation/types";
import type { ContentProjectCommand } from "../project/commands";
import type { ContentNode, ContentNodeKind, ContentProjectDocument } from "../project/types";
import {
	compileVideoPromptPlan,
	parseVideoPromptPlan,
} from "./generation-prompt-plan";
import {
	compileKeyframePromptPlan,
	parseKeyframePromptPlan,
	type ContentKeyframePromptPlan,
} from "./keyframe-prompt-plan";
import {
	CONTENT_VIDEO_REFERENCE_SEMANTIC_ROLES,
	CONTENT_VIDEO_SHOT_STRATEGIES,
	ContentVideoShotPlanError,
	selectContentVideoShotStrategy,
	type ContentVideoReferenceSemanticRole,
	type ContentVideoShotControlRequirements,
} from "./video-shot-plan";

interface ParsedVideoShotKeyframe {
	nodeId: string;
	plan: ContentKeyframePromptPlan;
}

interface ParsedVideoShotReference extends ContentGenerationSourceSpec {
	alias?: string;
	semanticRole?: ContentVideoReferenceSemanticRole;
	instruction?: string;
	kind: "image" | "video" | "audio";
	sourceKind: ContentNodeKind;
}

export function parseConfigureVideoShotOperation(
	operation: Record<string, unknown>,
	project: ContentProjectDocument,
	nodeSnapshots: Map<string, ContentNode>,
	models: readonly ContentModelDescriptor[],
): ContentProjectCommand[] {
	const targetNodeId = requiredString(operation, "targetNodeId");
	const target = nodeSnapshots.get(targetNodeId);
	if (!target) throw new Error(`node not found: ${targetNodeId}`);
	if (target.kind !== "video-generator") throw invalidGenerationTarget(target, nodeSnapshots);
	if (target.data.inputs?.some((binding) => binding.slotId === "promptReferences")) {
		throw new ContentVideoShotPlanError(
			"configure_video_shot requires media references to be declared in sources instead of legacy inline prompt bindings",
			"video-shot-inline-references-conflict",
			{ targetNodeId },
		);
	}

	const videoPlan = parseVideoPromptPlan(operation.promptPlan);
	const keyframes = parseVideoShotKeyframes(operation.keyframes, nodeSnapshots);
	const controlRequirements = parseVideoShotControlRequirements(operation.controlRequirements);
	const requestedStrategyValue = optionalString(operation, "strategy") ?? "automatic";
	if (!CONTENT_VIDEO_SHOT_STRATEGIES.includes(requestedStrategyValue as typeof CONTENT_VIDEO_SHOT_STRATEGIES[number])) {
		throw new Error(`unsupported video shot strategy: ${requestedStrategyValue}`);
	}
	const references = parseVideoShotReferences(operation.sources, project, nodeSnapshots);
	const strategy = selectContentVideoShotStrategy({
		requestedStrategy: requestedStrategyValue as typeof CONTENT_VIDEO_SHOT_STRATEGIES[number],
		controlRequirements,
		hasFirstFramePlan: Boolean(keyframes.first),
		hasLastFramePlan: Boolean(keyframes.last),
		sources: references.map(({ kind, semanticRole }) => ({ kind, semanticRole })),
	});

	const aspectRatio = optionalString(operation, "aspectRatio") ?? target.data.aspectRatio;
	const duration = operation.duration === undefined ? target.data.duration : requiredNumber(operation, "duration");
	const frameCommands: ContentProjectCommand[] = [];
	let generationSources: ContentGenerationSourceSpec[];
	let orderedReferences = references;

	if (strategy === "first-last-frame") {
		if (!aspectRatio) {
			throw new ContentVideoShotPlanError(
				"first-last-frame requires one explicit shot aspect ratio for both generated keyframes",
				"video-shot-aspect-ratio-required",
				{ strategy },
			);
		}
		if (!keyframes.first || !keyframes.last) {
			throw new ContentVideoShotPlanError(
				"first-last-frame requires distinct first and last keyframe plans",
				"video-shot-keyframes-required",
				{ required: ["keyframes.first", "keyframes.last"] },
			);
		}
		if (references.length > 0) {
			throw new ContentVideoShotPlanError(
				"first-last-frame receives media through keyframes, not additional omni-reference sources",
				"video-shot-strategy-conflict",
				{ strategy, unexpectedSources: references.map(({ sourceNodeId }) => sourceNodeId) },
			);
		}
		validateKeyframePair(keyframes.first, keyframes.last);
		frameCommands.push(
			keyframeUpdateCommand(keyframes.first, aspectRatio),
			keyframeUpdateCommand(keyframes.last, aspectRatio),
		);
		updateKeyframeSnapshot(nodeSnapshots, keyframes.first, aspectRatio);
		updateKeyframeSnapshot(nodeSnapshots, keyframes.last, aspectRatio);
		generationSources = [
			{ sourceNodeId: keyframes.first.nodeId, role: "firstFrame" },
			{ sourceNodeId: keyframes.last.nodeId, role: "lastFrame" },
		];
	} else if (strategy === "animate-still") {
		if (keyframes.last) {
			throw new ContentVideoShotPlanError(
				"animate-still cannot consume a last-frame plan",
				"video-shot-strategy-conflict",
				{ strategy, recommendedStrategy: "first-last-frame" },
			);
		}
		if (keyframes.first && references.length > 0) {
			throw new ContentVideoShotPlanError(
				"animate-still requires one opening authority, not both a keyframe plan and a separate source",
				"video-shot-source-conflict",
				{ strategy },
			);
		}
		if (keyframes.first) {
			frameCommands.push(keyframeUpdateCommand(keyframes.first, aspectRatio));
			updateKeyframeSnapshot(nodeSnapshots, keyframes.first, aspectRatio);
			generationSources = [{ sourceNodeId: keyframes.first.nodeId, role: "firstFrame" }];
		} else {
			generationSources = references.map(referenceSourceSpec);
		}
	} else if (strategy === "omni-reference") {
		if (!aspectRatio) {
			throw new ContentVideoShotPlanError(
				"omni-reference requires an explicit fixed shot aspect ratio",
				"video-shot-aspect-ratio-required",
				{ strategy },
			);
		}
		if (keyframes.first || keyframes.last) {
			throw new ContentVideoShotPlanError(
				"omni-reference sources must be declared in sources with semantic roles",
				"video-shot-strategy-conflict",
				{ strategy },
			);
		}
		orderedReferences = orderVideoShotReferencesForExecution(references);
		validateOmniReferenceManifest(orderedReferences, controlRequirements);
		generationSources = orderedReferences.map(referenceSourceSpec);
	} else if (strategy === "transform-video") {
		generationSources = references.map(referenceSourceSpec);
	} else {
		if (references.length > 0 || keyframes.first || keyframes.last) {
			throw new ContentVideoShotPlanError(
				"text-to-video does not accept keyframes or media references",
				"video-shot-strategy-conflict",
				{ strategy },
			);
		}
		generationSources = [];
	}

	const intent = strategyToGenerationIntent(strategy);
	const modelSelection = optionalString(operation, "modelSelection");
	const providerId = modelSelection === "automatic"
		? undefined
		: optionalString(operation, "providerId") ?? target.data.providerId;
	const modelId = modelSelection === "automatic"
		? undefined
		: optionalString(operation, "modelId") ?? target.data.modelId;
	if (modelSelection === "specific" && (!providerId || !modelId)) {
		throw new Error("specific model selection requires providerId and modelId");
	}

	const prompt = strategy === "omni-reference"
		? compileOmniReferencePrompt(videoPlan, orderedReferences, duration)
		: compileVideoPromptPlan(videoPlan, { durationSeconds: duration });
	const targetData: ContentNode["data"] = {
		prompt,
		promptOptimization: undefined,
		...(aspectRatio ? { aspectRatio } : {}),
		...(duration === undefined ? {} : { duration }),
	};
	target.data = { ...target.data, ...targetData };
	const planningProject = {
		...project,
		graph: { ...project.graph, nodes: [...nodeSnapshots.values()] },
	};
	const generationPlan = planContentVideoGeneration(
		planningProject,
		targetNodeId,
		intent,
		generationSources,
		models,
		{ providerId, modelId },
	);
	const selectedModel = models.find(
		(model) => model.providerId === generationPlan.providerId && model.modelId === generationPlan.modelId,
	);
	if (aspectRatio && selectedModel?.aspectRatios.length && !selectedModel.aspectRatios.includes(aspectRatio)) {
		throw new ContentVideoShotPlanError(
			"selected video model does not support the requested shot aspect ratio",
			"video-shot-aspect-ratio-unsupported",
			{ aspectRatio, supportedAspectRatios: selectedModel.aspectRatios },
		);
	}
	target.data = {
		...target.data,
		providerId: generationPlan.providerId,
		modelId: generationPlan.modelId,
		modeId: generationPlan.modeId,
	};
	return [
		...frameCommands,
		{ type: "node.update", nodeId: targetNodeId, data: targetData },
		{ type: "node.configure-generation", targetNodeId, plan: generationPlan },
	];
}

function parseVideoShotKeyframes(
	value: unknown,
	nodes: ReadonlyMap<string, ContentNode>,
): { first?: ParsedVideoShotKeyframe; last?: ParsedVideoShotKeyframe } {
	if (value === undefined) return {};
	const keyframes = asRecord(value);
	return {
		...(keyframes.first === undefined ? {} : { first: parseVideoShotKeyframe(keyframes.first, "first", nodes) }),
		...(keyframes.last === undefined ? {} : { last: parseVideoShotKeyframe(keyframes.last, "last", nodes) }),
	};
}

function parseVideoShotKeyframe(
	value: unknown,
	phase: "first" | "last",
	nodes: ReadonlyMap<string, ContentNode>,
): ParsedVideoShotKeyframe {
	const keyframe = asRecord(value);
	const nodeId = requiredString(keyframe, "nodeId");
	const node = nodes.get(nodeId);
	if (!node) throw new Error(`node not found: ${nodeId}`);
	if (node.kind !== "image-generator") {
		throw new ContentVideoShotPlanError(
			`${phase} keyframe must target an image-generator`,
			"video-shot-keyframe-target-invalid",
			{ phase, nodeId, nodeKind: node.kind },
		);
	}
	const plan = parseKeyframePromptPlan(keyframe.promptPlan);
	if (plan.phase !== phase) {
		throw new ContentVideoShotPlanError(
			`${phase} keyframe requires a matching ${phase} prompt phase`,
			"video-shot-keyframe-phase-mismatch",
			{ expectedPhase: phase, receivedPhase: plan.phase, nodeId },
		);
	}
	return { nodeId, plan };
}

function parseVideoShotControlRequirements(value: unknown): ContentVideoShotControlRequirements {
	if (value === undefined) return {};
	const requirements = asRecord(value);
	return {
		...booleanProperty(requirements, "exactOpening"),
		...booleanProperty(requirements, "exactEnding"),
		...booleanProperty(requirements, "requiresSceneReference"),
	};
}

function booleanProperty(
	record: Record<string, unknown>,
	key: keyof ContentVideoShotControlRequirements,
): Partial<ContentVideoShotControlRequirements> {
	const value = record[key];
	if (value === undefined) return {};
	if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
	return { [key]: value };
}

function parseVideoShotReferences(
	value: unknown,
	project: ContentProjectDocument,
	nodes: ReadonlyMap<string, ContentNode>,
): ParsedVideoShotReference[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("configure_video_shot sources must be an array");
	return value.map((item) => {
		const source = asRecord(item);
		const sourceNodeId = requiredString(source, "sourceNodeId");
		const node = nodes.get(sourceNodeId);
		if (!node) throw new Error(`node not found: ${sourceNodeId}`);
		const assetIdsValue = source.assetIds;
		if (assetIdsValue !== undefined && (!Array.isArray(assetIdsValue) || !assetIdsValue.every((id) => typeof id === "string"))) {
			throw new Error("configure_video_shot source assetIds must be an array of strings");
		}
		const assetIds = assetIdsValue as string[] | undefined;
		let kind: ParsedVideoShotReference["kind"];
		if (node.kind === "image-generator") {
			if (assetIds?.length) throw new Error("generated image sources cannot include assetIds");
			kind = "image";
		} else if (node.kind === "video-generator") {
			if (assetIds?.length) throw new Error("generated video sources cannot include assetIds");
			kind = "video";
		} else if (node.kind === "asset") {
			if (assetIds?.length !== 1) {
				throw new ContentVideoShotPlanError(
					"each semantic video-shot source must select exactly one asset",
					"video-shot-reference-asset-ambiguous",
					{ sourceNodeId },
				);
			}
			const asset = project.assets.find((candidate) => candidate.id === assetIds[0]);
			if (!asset || !(node.data.assetIds ?? []).includes(asset.id)) {
				throw new Error(`generation source asset not found: ${assetIds[0]}`);
			}
			kind = asset.kind;
		} else {
			throw new Error("video-shot sources must be asset, image-generator, or video-generator nodes");
		}
		const semanticRole = optionalString(source, "semanticRole");
		if (source.role !== undefined) {
			throw new ContentVideoShotPlanError(
				"configure_video_shot assigns provider input roles from strategy; use semanticRole instead of role",
				"video-shot-technical-role-unexpected",
				{ sourceNodeId, receivedRole: source.role },
			);
		}
		if (
			semanticRole &&
			!CONTENT_VIDEO_REFERENCE_SEMANTIC_ROLES.includes(semanticRole as ContentVideoReferenceSemanticRole)
		) {
			throw new Error(`unsupported semantic reference role: ${semanticRole}`);
		}
		return {
			sourceNodeId,
			...(assetIds ? { assetIds } : {}),
			alias: optionalString(source, "alias"),
			semanticRole: semanticRole as ContentVideoReferenceSemanticRole | undefined,
			instruction: optionalString(source, "instruction"),
			kind,
			sourceKind: node.kind,
		};
	});
}

function validateKeyframePair(first: ParsedVideoShotKeyframe, last: ParsedVideoShotKeyframe): void {
	if (first.nodeId === last.nodeId) {
		throw new ContentVideoShotPlanError(
			"first and last frames must use distinct image-generator nodes",
			"video-shot-keyframes-not-distinct",
			{ nodeId: first.nodeId },
		);
	}
	if (first.plan.visibleState === last.plan.visibleState) {
		throw new ContentVideoShotPlanError(
			"first and last frames must describe distinct visible states",
			"video-shot-keyframe-states-not-distinct",
			{ firstNodeId: first.nodeId, lastNodeId: last.nodeId },
		);
	}
	const firstInvariants = new Set(first.plan.protectedInvariants.map((value) => value.toLowerCase()));
	if (!last.plan.protectedInvariants.some((value) => firstInvariants.has(value.toLowerCase()))) {
		throw new ContentVideoShotPlanError(
			"first and last frames must share explicit continuity invariants",
			"video-shot-keyframe-continuity-missing",
			{ firstNodeId: first.nodeId, lastNodeId: last.nodeId },
		);
	}
	const incompatibleFields = [
		...(sameContractValue(first.plan.environment, last.plan.environment) ? [] : ["environment"]),
		...(sameContractValue(first.plan.composition.cameraAxis, last.plan.composition.cameraAxis)
			? []
			: ["composition.cameraAxis"]),
		...(sameContractValue(first.plan.lighting.direction, last.plan.lighting.direction)
			? []
			: ["lighting.direction"]),
	];
	if (incompatibleFields.length > 0) {
		throw new ContentVideoShotPlanError(
			"first and last frames disagree on shot continuity fields",
			"video-shot-keyframe-continuity-conflict",
			{ firstNodeId: first.nodeId, lastNodeId: last.nodeId, incompatibleFields },
		);
	}
}

function sameContractValue(left: string, right: string): boolean {
	return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function keyframeUpdateCommand(
	keyframe: ParsedVideoShotKeyframe,
	aspectRatio?: string,
): ContentProjectCommand {
	return {
		type: "node.update",
		nodeId: keyframe.nodeId,
		data: {
			prompt: compileKeyframePromptPlan(keyframe.plan),
			promptOptimization: undefined,
			...(aspectRatio ? { aspectRatio } : {}),
		},
	};
}

function updateKeyframeSnapshot(
	nodes: Map<string, ContentNode>,
	keyframe: ParsedVideoShotKeyframe,
	aspectRatio?: string,
): void {
	const node = nodes.get(keyframe.nodeId);
	if (!node) return;
	node.data = {
		...node.data,
		prompt: compileKeyframePromptPlan(keyframe.plan),
		promptOptimization: undefined,
		...(aspectRatio ? { aspectRatio } : {}),
	};
}

function orderVideoShotReferencesForExecution(
	references: readonly ParsedVideoShotReference[],
): ParsedVideoShotReference[] {
	return [
		...references.filter(({ sourceKind }) => sourceKind === "asset"),
		...references.filter(({ sourceKind }) => sourceKind !== "asset"),
	];
}

function validateOmniReferenceManifest(
	references: readonly ParsedVideoShotReference[],
	requirements: ContentVideoShotControlRequirements,
): void {
	if (references.length === 0) {
		throw new ContentVideoShotPlanError(
			"omni-reference requires at least one semantic reference",
			"video-shot-references-required",
			{},
		);
	}
	const aliases = new Set<string>();
	const sourceKeys = new Set<string>();
	for (const reference of references) {
		if (!reference.alias || !reference.semanticRole || !reference.instruction) {
			throw new ContentVideoShotPlanError(
				"every omni reference requires alias, semanticRole, and instruction",
				"video-shot-reference-manifest-incomplete",
				{ sourceNodeId: reference.sourceNodeId },
			);
		}
		if (aliases.has(reference.alias)) {
			throw new ContentVideoShotPlanError(
				"omni reference aliases must be unique",
				"video-shot-reference-alias-duplicate",
				{ alias: reference.alias },
			);
		}
		aliases.add(reference.alias);
		const sourceKey = `${reference.sourceNodeId}:${reference.assetIds?.[0] ?? "generated"}`;
		if (sourceKeys.has(sourceKey)) {
			throw new ContentVideoShotPlanError(
				"each omni manifest entry must identify a distinct media input",
				"video-shot-reference-duplicate",
				{ sourceNodeId: reference.sourceNodeId, assetId: reference.assetIds?.[0] },
			);
		}
		sourceKeys.add(sourceKey);
	}
	if (requirements.requiresSceneReference && !references.some(({ semanticRole }) => semanticRole === "environment")) {
		throw new ContentVideoShotPlanError(
			"this shot requires an environment reference for spatial and lighting authority",
			"video-shot-environment-reference-required",
			{ requiredSemanticRole: "environment" },
		);
	}
}

function referenceSourceSpec(reference: ParsedVideoShotReference): ContentGenerationSourceSpec {
	return {
		sourceNodeId: reference.sourceNodeId,
		...(reference.assetIds ? { assetIds: reference.assetIds } : {}),
	};
}

function strategyToGenerationIntent(strategy: Exclude<typeof CONTENT_VIDEO_SHOT_STRATEGIES[number], "automatic">): ContentVideoGenerationIntent {
	if (strategy === "first-last-frame") return "interpolate-frames";
	if (strategy === "omni-reference") return "reference-guided";
	return strategy;
}

function compileOmniReferencePrompt(
	plan: ReturnType<typeof parseVideoPromptPlan>,
	references: readonly ParsedVideoShotReference[],
	durationSeconds?: number,
): string {
	const kindCounts = new Map<ParsedVideoShotReference["kind"], number>();
	const manifest = references.map((reference) => {
		const index = (kindCounts.get(reference.kind) ?? 0) + 1;
		kindCounts.set(reference.kind, index);
		const token = reference.kind === "image"
			? `<Picture ${index}>`
			: reference.kind === "video"
				? `<Video ${index}>`
				: `<Audio ${index}>`;
		return `${token}: ${reference.alias} (${reference.semanticRole}). ${sentence(reference.instruction ?? "")}`;
	});
	return [
		"Reference manifest:",
		...manifest,
		compileVideoPromptPlan(plan, { durationSeconds }),
	].join("\n");
}

function sentence(value: string): string {
	return `${value.trim().replace(/[.\s]+$/g, "")}.`;
}

function invalidGenerationTarget(
	target: ContentNode,
	nodes: ReadonlyMap<string, ContentNode>,
): ContentGenerationIntentError {
	return new ContentGenerationIntentError(
		"configure_video_shot targetNodeId must identify the receiving video-generator; put media inputs in sources[]",
		"generation-intent-target-invalid",
		{
			targetNodeId: target.id,
			targetKind: target.kind,
			videoGeneratorNodeIds: [...nodes.values()]
				.filter((node) => node.kind === "video-generator")
				.map((node) => node.id),
		},
	);
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("operation must be an object");
	return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${key} is required`);
	return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`${key} must be a string`);
	return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
	return value;
}
