import {
	CONTENT_GENERATION_SOURCE_ROLES,
	CONTENT_VIDEO_GENERATION_INTENTS,
	ContentGenerationIntentError,
	planContentVideoGeneration,
	type ContentGenerationSourceRole,
	type ContentGenerationSourceSpec,
	type ContentVideoGenerationIntent,
} from "../generation/generation-intent";
import type { ContentModelDescriptor } from "../generation/types";
import { CONTENT_NODE_DEFINITIONS } from "../node/definitions";
import { getContentNodeSize } from "../node/geometry";
import type { ContentProjectCommand } from "../project/commands";
import type {
	ContentNode,
	ContentNodeKind,
	ContentProjectDocument,
	ContentWorkflowDeliverable,
} from "../project/types";
import {
	compileVideoPromptPlan,
	parseVideoPromptPlan,
} from "./generation-prompt-plan";
import {
	compileKeyframePromptPlan,
	parseKeyframePromptPlan,
} from "./keyframe-prompt-plan";
import { parseConfigureVideoShotOperation } from "./configure-video-shot-operation";
import { createContentAgentOperationSchema } from "./operation-schema";
import { CONTENT_VIDEO_SHOT_STRATEGIES } from "./video-shot-plan";

const NODE_KINDS: readonly ContentNodeKind[] = CONTENT_NODE_DEFINITIONS.map((definition) => definition.kind);
const DELIVERABLE_TYPES: readonly ContentWorkflowDeliverable["type"][] = [
	"image",
	"video",
	"audio",
	"text",
	"content",
];

const CANONICAL_AGENT_TARGET_INPUTS = [
	"mediaSources",
	"promptSources",
	"referenceImages",
	"contentSources",
] as const;

type AgentTargetInput = (typeof CANONICAL_AGENT_TARGET_INPUTS)[number];

export const CONTENT_AGENT_OPERATION_SCHEMA = createContentAgentOperationSchema(NODE_KINDS, DELIVERABLE_TYPES);

interface PlacementFrame {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export function parseContentAgentOperations(
	project: ContentProjectDocument,
	values: readonly unknown[],
	models: readonly ContentModelDescriptor[] = [],
): ContentProjectCommand[] {
	const frames = project.graph.nodes.map(toPlacementFrame);
	const nodeKinds = new Map(project.graph.nodes.map((node) => [node.id, node.kind]));
	const nodeSnapshots = new Map(project.graph.nodes.map((node) => [node.id, structuredClone(node)]));
	const promptSourcesByTarget = collectPromptSourcesByTarget(project, values);
	return values.flatMap((value) => {
		if (isRedundantVideoMediaConnection(value, values, nodeKinds)) return [];
		const parsed = parseOperation(
			value,
			project,
			frames,
			nodeKinds,
			nodeSnapshots,
			models,
			promptSourcesByTarget,
		);
		return Array.isArray(parsed) ? parsed : [parsed];
	});
}

function parseOperation(
	value: unknown,
	project: ContentProjectDocument,
	frames: PlacementFrame[],
	nodeKinds: Map<string, ContentNodeKind>,
	nodeSnapshots: Map<string, ContentNode>,
	models: readonly ContentModelDescriptor[],
	promptSourcesByTarget: ReadonlyMap<string, readonly string[]>,
): ContentProjectCommand | ContentProjectCommand[] {
	const operation = asRecord(value);
	const type = requiredString(operation, "type");
	switch (type) {
		case "update_workflow": {
			const title = optionalString(operation, "title");
			const objective = optionalString(operation, "objective");
			const deliverables = parseDeliverables(operation.deliverables);
			if (title === undefined && objective === undefined && deliverables === undefined) {
				throw new Error("update_workflow requires title, objective, or deliverables");
			}
			return {
				type: "workflow.update",
				workflow: {
					...(title === undefined ? {} : { title: title.trim() }),
					...(objective === undefined ? {} : { objective }),
					...(deliverables === undefined ? {} : { deliverables }),
				},
			};
		}
		case "add_node": {
			const kind = requiredString(operation, "kind");
			if (!NODE_KINDS.includes(kind as ContentNodeKind)) throw new Error(`unsupported node kind: ${kind}`);
			const nodeKind = kind as ContentNodeKind;
			const id = optionalString(operation, "id")?.trim() || crypto.randomUUID();
			const data = parseNodeData(operation, nodeKind);
			const position = resolveNodePosition(operation, frames);
			const size = getContentNodeSize(nodeKind, data.aspectRatio);
			frames.push({ id, ...position, ...size });
			nodeKinds.set(id, nodeKind);
			nodeSnapshots.set(id, {
				id,
				kind: nodeKind,
				name: optionalString(operation, "name"),
				purpose: optionalString(operation, "purpose"),
				position,
				...size,
				layoutOwnership: "automatic",
				status: "idle",
				data,
			});
			return {
				type: "node.add",
				node: {
					id,
					kind: nodeKind,
					name: optionalString(operation, "name"),
					purpose: optionalString(operation, "purpose"),
					position,
					data,
					layoutOwnership: "automatic",
				},
			};
		}
		case "rename_node":
			return { type: "node.rename", nodeId: requiredString(operation, "nodeId"), name: requiredString(operation, "name") };
		case "set_node_purpose":
			return {
				type: "node.set-purpose",
				nodeId: requiredString(operation, "nodeId"),
				purpose: requiredString(operation, "purpose"),
			};
		case "update_node": {
			const nodeId = requiredString(operation, "nodeId");
			const snapshot = nodeSnapshots.get(nodeId);
			if (!snapshot) throw new Error(`node not found: ${nodeId}`);
			const data = parseNodeData(operation, snapshot.kind);
			snapshot.data = { ...snapshot.data, ...data };
			return { type: "node.update", nodeId, data };
		}
		case "delete_node": {
			const nodeId = requiredString(operation, "nodeId");
			nodeKinds.delete(nodeId);
			nodeSnapshots.delete(nodeId);
			return { type: "node.delete", nodeId };
		}
		case "duplicate_node": {
			const nodeId = requiredString(operation, "nodeId");
			const sourceKind = nodeKinds.get(nodeId);
			if (!sourceKind) throw new Error(`node not found: ${nodeId}`);
			const id = optionalString(operation, "id")?.trim() || crypto.randomUUID();
			nodeKinds.set(id, sourceKind);
			const source = nodeSnapshots.get(nodeId);
			if (!source) throw new Error(`node not found: ${nodeId}`);
			nodeSnapshots.set(id, { ...structuredClone(source), id });
			return {
				type: "node.duplicate",
				nodeId,
				id,
				layoutOwnership: "automatic",
			};
		}
		case "connect_nodes": {
			const source = requiredAliasedString(operation, "sourceNodeId", "source");
			const target = requiredAliasedString(operation, "targetNodeId", "target");
			const targetKind = nodeKinds.get(target);
			const sourceKind = nodeKinds.get(source);
			if (!sourceKind) throw new Error(`node not found: ${source}`);
			if (!targetKind) throw new Error(`node not found: ${target}`);
			const targetInput = resolveAgentTargetInput(targetKind, operation.targetInput);
			if (targetKind === "video-generator" && sourceKind !== "prompt") {
				throw new ContentGenerationIntentError(
					"video media inputs must use configure_video_shot so strategy and business roles are explicit",
					"generation-semantic-connection-required",
					{
						sourceNodeId: source,
						targetNodeId: target,
						requiredOperation: "configure_video_shot",
						suggestedSource: { sourceNodeId: source },
						suggestedOperation: {
							type: "configure_video_shot",
							targetNodeId: target,
							strategy: "automatic",
							sources: [{ sourceNodeId: source }],
						},
						requiredFields: ["promptPlan"],
						strategies: CONTENT_VIDEO_SHOT_STRATEGIES,
					},
				);
			}
			if (targetKind === "image-generator" && sourceKind === "asset") {
				throw new ContentGenerationIntentError(
					"asset inputs for image generators must use bind_assets with concrete asset IDs",
					"generation-semantic-connection-required",
					{ sourceNodeId: source, targetNodeId: target },
				);
			}
			if (
				targetKind === "image-generator" &&
				sourceKind === "image-generator" &&
				targetInput !== "referenceImages"
			) {
				throw new ContentGenerationIntentError(
					"generated image references require targetInput referenceImages",
					"generation-semantic-connection-required",
					{ sourceNodeId: source, targetNodeId: target },
				);
			}
			return {
				type: "edge.connect",
				id: optionalAliasedString(operation, "edgeId", "id")?.trim() || crypto.randomUUID(),
				source,
				target,
				targetHandle: targetInput ? targetHandleForAgentInput(targetKind, targetInput) : undefined,
				...(targetKind === "image-generator" && sourceKind === "image-generator"
					? { role: "referenceImages" }
					: {}),
			};
		}
		case "bind_assets": {
			const source = requiredAliasedString(operation, "sourceNodeId", "source");
			const target = requiredAliasedString(operation, "targetNodeId", "target");
			if (nodeKinds.get(source) !== "asset") throw new Error("bind_assets source must be an asset node");
			const targetKind = nodeKinds.get(target);
			if (targetKind !== "image-generator") {
				throw new ContentGenerationIntentError(
					"video generator media inputs must use configure_video_shot",
					"generation-semantic-connection-required",
					{
						sourceNodeId: source,
						targetNodeId: target,
						requiredOperation: "configure_video_shot",
					},
				);
			}
			const targetInput = resolveAgentTargetInput(targetKind, operation.targetInput);
			if (!targetInput) throw new Error("bind_assets requires targetInput");
			const binding = assetBindingForAgentInput(targetKind, targetInput);
			const assetIds = operation.assetIds;
			if (!Array.isArray(assetIds) || assetIds.length === 0 || !assetIds.every((assetId) => typeof assetId === "string")) {
				throw new Error("bind_assets requires non-empty assetIds");
			}
			return {
				type: "node.bind-assets",
				sourceNodeId: source,
				targetNodeId: target,
				assetIds,
				...binding,
			};
		}
		case "configure_generation": {
			const explicitTargetNodeId = optionalString(operation, "targetNodeId");
			const legacyTargetNodeId = optionalString(operation, "nodeId");
			if (explicitTargetNodeId && legacyTargetNodeId && explicitTargetNodeId !== legacyTargetNodeId) {
				throw new ContentGenerationIntentError(
					"configure_generation targetNodeId and legacy nodeId identify different nodes",
					"generation-intent-target-ambiguous",
					{ targetNodeId: explicitTargetNodeId, nodeId: legacyTargetNodeId },
				);
			}
			const targetNodeId = explicitTargetNodeId ?? legacyTargetNodeId;
			if (!targetNodeId) {
				throw new ContentGenerationIntentError(
					"configure_generation requires targetNodeId for the receiving video-generator",
					"generation-intent-target-required",
					{ videoGeneratorNodeIds: listNodeIdsByKind(nodeSnapshots, "video-generator") },
				);
			}
			const target = nodeSnapshots.get(targetNodeId);
			if (!target) throw new Error(`node not found: ${targetNodeId}`);
			if (target.kind !== "video-generator") {
				throw invalidGenerationTarget(target, nodeSnapshots);
			}
			const intentValue = requiredString(operation, "generationIntent");
			if (!CONTENT_VIDEO_GENERATION_INTENTS.includes(intentValue as ContentVideoGenerationIntent)) {
				throw new Error(`unsupported generation intent: ${intentValue}`);
			}
			const sources = parseGenerationSources(operation.sources);
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
			const planningProject = {
				...project,
				graph: { ...project.graph, nodes: [...nodeSnapshots.values()] },
			};
			const plan = planContentVideoGeneration(
				planningProject,
				targetNodeId,
				intentValue as ContentVideoGenerationIntent,
				sources,
				models,
				{ providerId, modelId },
			);
			target.data = {
				...target.data,
				providerId: plan.providerId,
				modelId: plan.modelId,
				modeId: plan.modeId,
			};
			return { type: "node.configure-generation", targetNodeId, plan };
		}
		case "configure_video_shot":
			return parseConfigureVideoShotOperation(
				operation,
				project,
				nodeSnapshots,
				models,
				promptSourcesByTarget.get(requiredString(operation, "targetNodeId")) ?? [],
			);
		case "delete_edge":
			return { type: "edge.delete", edgeId: requiredString(operation, "edgeId") };
		default:
			throw new Error(`unsupported operation type: ${type}`);
	}
}

function resolveAgentTargetInput(kind: ContentNodeKind, value: unknown): AgentTargetInput | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw new ContentGenerationIntentError(
			"targetInput must be a string",
			"target-input-unsupported",
			{ targetKind: kind, allowedTargetInputs: allowedTargetInputs(kind) },
		);
	}
	if (CANONICAL_AGENT_TARGET_INPUTS.includes(value as AgentTargetInput)) return value as AgentTargetInput;
	const normalized = TARGET_INPUT_ALIASES[kind]?.[value];
	if (normalized) return normalized;
	throw new ContentGenerationIntentError(
		`targetInput ${value} is not supported for ${kind}`,
		"target-input-unsupported",
		{ targetKind: kind, receivedTargetInput: value, allowedTargetInputs: allowedTargetInputs(kind) },
	);
}

function collectPromptSourcesByTarget(
	project: ContentProjectDocument,
	values: readonly unknown[],
): Map<string, string[]> {
	const result = new Map<string, string[]>();
	const nodeKinds = new Map(project.graph.nodes.map((node) => [node.id, node.kind]));
	for (const value of values) {
		if (!isRecord(value) || value.type !== "add_node") continue;
		if (typeof value.id !== "string" || typeof value.kind !== "string") continue;
		if (NODE_KINDS.includes(value.kind as ContentNodeKind)) {
			nodeKinds.set(value.id, value.kind as ContentNodeKind);
		}
	}
	for (const edge of project.graph.edges) {
		if (edge.targetHandle === "prompt" && nodeKinds.get(edge.source) === "prompt") {
			appendUnique(result, edge.target, edge.source);
		}
	}
	for (const value of values) {
		if (!isRecord(value) || value.type !== "connect_nodes") continue;
		const source = readAliasedString(value, "sourceNodeId", "source");
		const target = readAliasedString(value, "targetNodeId", "target");
		if (!source || !target || nodeKinds.get(source) !== "prompt") continue;
		if (value.targetInput === undefined || ["promptSources", "prompt", "text"].includes(String(value.targetInput))) {
			appendUnique(result, target, source);
		}
	}
	return result;
}

function isRedundantVideoMediaConnection(
	value: unknown,
	values: readonly unknown[],
	nodeKinds: ReadonlyMap<string, ContentNodeKind>,
): boolean {
	if (!isRecord(value) || value.type !== "connect_nodes") return false;
	const source = readAliasedString(value, "sourceNodeId", "source");
	const target = readAliasedString(value, "targetNodeId", "target");
	if (!source || !target || nodeKinds.get(target) !== "video-generator" || nodeKinds.get(source) === "prompt") {
		return false;
	}
	return values.some((candidate) => {
		if (!isRecord(candidate) || candidate.type !== "configure_video_shot") return false;
		if (candidate.targetNodeId !== target) return false;
		const sources = Array.isArray(candidate.sources) ? candidate.sources : [];
		if (sources.some((item) => isRecord(item) && item.sourceNodeId === source)) return true;
		if (!isRecord(candidate.keyframes)) return false;
		return [candidate.keyframes.first, candidate.keyframes.last]
			.some((keyframe) => isRecord(keyframe) && keyframe.nodeId === source);
	});
}

function appendUnique(map: Map<string, string[]>, key: string, value: string): void {
	const values = map.get(key) ?? [];
	if (!values.includes(value)) values.push(value);
	map.set(key, values);
}

function targetHandleForAgentInput(kind: ContentNodeKind, input: AgentTargetInput): string {
	const mapping: Partial<Record<ContentNodeKind, Partial<Record<AgentTargetInput, string>>>> = {
		prompt: { mediaSources: "media" },
		"image-generator": { promptSources: "prompt", referenceImages: "reference" },
		"video-generator": { promptSources: "prompt" },
		output: { contentSources: "content" },
	};
	const handle = mapping[kind]?.[input];
	if (!handle) {
		throw new ContentGenerationIntentError(
			`targetInput ${input} is not valid for ${kind}`,
			"target-input-invalid-for-node",
			{ targetKind: kind, receivedTargetInput: input, allowedTargetInputs: allowedTargetInputs(kind) },
		);
	}
	return handle;
}

const TARGET_INPUT_ALIASES: Partial<Record<ContentNodeKind, Readonly<Record<string, AgentTargetInput>>>> = {
	prompt: {
		media: "mediaSources",
		image: "mediaSources",
		video: "mediaSources",
		audio: "mediaSources",
	},
	"image-generator": {
		prompt: "promptSources",
		text: "promptSources",
		reference: "referenceImages",
		image: "referenceImages",
		startImages: "referenceImages",
		firstFrame: "referenceImages",
	},
	"video-generator": {
		prompt: "promptSources",
		text: "promptSources",
		image: "mediaSources",
		video: "mediaSources",
		audio: "mediaSources",
		startImages: "mediaSources",
		firstFrame: "mediaSources",
		lastFrame: "mediaSources",
		referenceVideos: "mediaSources",
		referenceAudios: "mediaSources",
	},
	output: {
		content: "contentSources",
		deliverable: "contentSources",
		image: "contentSources",
		video: "contentSources",
		audio: "contentSources",
	},
};

function allowedTargetInputs(kind: ContentNodeKind): string[] {
	return [...new Set([
		...Object.values(TARGET_INPUT_ALIASES[kind] ?? {}),
		...Object.keys(TARGET_INPUT_ALIASES[kind] ?? {}),
	])];
}

function invalidGenerationTarget(
	target: ContentNode,
	nodes: ReadonlyMap<string, ContentNode>,
): ContentGenerationIntentError {
	return new ContentGenerationIntentError(
		"configure_generation targetNodeId must identify the receiving video-generator; put image/video inputs in sources[]",
		"generation-intent-target-invalid",
		{
			targetNodeId: target.id,
			targetKind: target.kind,
			videoGeneratorNodeIds: listNodeIdsByKind(nodes, "video-generator"),
			suggestedSource: { sourceNodeId: target.id },
		},
	);
}

function listNodeIdsByKind(nodes: ReadonlyMap<string, ContentNode>, kind: ContentNodeKind): string[] {
	return [...nodes.values()].filter((node) => node.kind === kind).map((node) => node.id);
}

function assetBindingForAgentInput(
	kind: "image-generator",
	input: AgentTargetInput,
): { targetHandle: string; slotId: string } {
	if (kind === "image-generator" && input === "referenceImages") {
		return { targetHandle: "reference", slotId: "referenceImages" };
	}
	throw new Error(`targetInput ${input} cannot bind assets to ${kind}`);
}

function parseGenerationSources(value: unknown): ContentGenerationSourceSpec[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("configure_generation sources must be an array");
	return value.map((item) => {
		const source = asRecord(item);
		const role = optionalString(source, "role");
		if (role && !CONTENT_GENERATION_SOURCE_ROLES.includes(role as ContentGenerationSourceRole)) {
			throw new Error(`unsupported generation source role: ${role}`);
		}
		const assetIds = source.assetIds;
		if (assetIds !== undefined && (!Array.isArray(assetIds) || !assetIds.every((id) => typeof id === "string"))) {
			throw new Error("generation source assetIds must be an array of strings");
		}
		return {
			sourceNodeId: requiredString(source, "sourceNodeId"),
			...(assetIds ? { assetIds } : {}),
			...(role ? { role: role as ContentGenerationSourceRole } : {}),
		};
	});
}

function parseNodeData(record: Record<string, unknown>, nodeKind?: ContentNodeKind): ContentNode["data"] {
	const data: ContentNode["data"] = {};
	const duration = record.duration === undefined ? undefined : requiredNumber(record, "duration");
	if (record.promptPlan !== undefined) {
		if (record.prompt !== undefined) {
			throw new Error("prompt and promptPlan cannot be used together");
		}
		const promptPlan = asRecord(record.promptPlan);
		if (promptPlan.kind === "image-keyframe") {
			if (nodeKind !== "image-generator") {
				throw new Error("image-keyframe promptPlan can only configure an image-generator node");
			}
			data.prompt = compileKeyframePromptPlan(parseKeyframePromptPlan(promptPlan));
		} else {
			if (nodeKind !== "video-generator" && nodeKind !== "prompt") {
				throw new Error("video-shot promptPlan can only configure a video-generator or prompt node");
			}
			data.prompt = compileVideoPromptPlan(parseVideoPromptPlan(promptPlan), {
				durationSeconds: duration,
			});
		}
	} else {
		copyOptionalString(record, data, "prompt");
	}
	copyOptionalString(record, data, "aspectRatio");
	copyOptionalString(record, data, "quality");
	copyOptionalString(record, data, "resolution");
	copyOptionalString(record, data, "providerId");
	copyOptionalString(record, data, "modelId");
	copyOptionalString(record, data, "modeId");
	if (data.prompt !== undefined) data.promptOptimization = undefined;
	if (record.modelSelection === "automatic") {
		data.providerId = undefined;
		data.modelId = undefined;
		data.modeId = undefined;
	}
	if (record.modelSelection === "specific" && (!data.providerId || !data.modelId)) {
		throw new Error("specific model selection requires providerId and modelId");
	}
	const assetIds = record.assetIds;
	if (assetIds !== undefined) {
		if (!Array.isArray(assetIds) || !assetIds.every((assetId) => typeof assetId === "string")) {
			throw new Error("assetIds must be an array of strings");
		}
		data.assetIds = assetIds;
	}
	if (duration !== undefined) data.duration = duration;
	return data;
}

function copyOptionalString(
	record: Record<string, unknown>,
	target: ContentNode["data"],
	key: "prompt" | "aspectRatio" | "quality" | "resolution" | "providerId" | "modelId" | "modeId",
): void {
	const value = optionalString(record, key);
	if (value !== undefined) target[key] = value;
}

function resolveNodePosition(record: Record<string, unknown>, frames: readonly PlacementFrame[]) {
	const afterNodeId = optionalString(record, "afterNodeId");
	const after = afterNodeId ? frames.find((frame) => frame.id === afterNodeId) : undefined;
	if (afterNodeId && !after) throw new Error(`placement node not found: ${afterNodeId}`);
	if (after) return { x: after.x + after.width + 80, y: after.y };
	if (frames.length === 0) return { x: 0, y: 0 };
	const rightmost = frames.reduce((current, frame) =>
		frame.x + frame.width > current.x + current.width ? frame : current,
	);
	return { x: rightmost.x + rightmost.width + 80, y: rightmost.y };
}

function toPlacementFrame(node: ContentNode): PlacementFrame {
	const size = getContentNodeSize(node.kind, node.data.aspectRatio);
	return {
		id: node.id,
		x: node.position.x,
		y: node.position.y,
		width: node.width ?? size.width,
		height: node.height ?? size.height,
	};
}

function parseDeliverables(value: unknown): ContentWorkflowDeliverable[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error("deliverables must be an array");
	return value.map((item) => {
		const deliverable = asRecord(item);
		const type = requiredString(deliverable, "type");
		if (!DELIVERABLE_TYPES.includes(type as ContentWorkflowDeliverable["type"])) {
			throw new Error(`unsupported deliverable type: ${type}`);
		}
		return {
			type: type as ContentWorkflowDeliverable["type"],
			fromNode: requiredString(deliverable, "fromNode"),
			description: requiredString(deliverable, "description"),
		};
	});
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) throw new Error("operation must be an object");
	return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredAliasedString(
	record: Record<string, unknown>,
	canonicalKey: string,
	legacyKey: string,
): string {
	const value = optionalAliasedString(record, canonicalKey, legacyKey);
	if (!value?.trim()) throw new Error(`${canonicalKey} is required`);
	return value.trim();
}

function optionalAliasedString(
	record: Record<string, unknown>,
	canonicalKey: string,
	legacyKey: string,
): string | undefined {
	const canonical = optionalString(record, canonicalKey);
	const legacy = optionalString(record, legacyKey);
	if (canonical?.trim() && legacy?.trim() && canonical.trim() !== legacy.trim()) {
		throw new ContentGenerationIntentError(
			`${canonicalKey} and legacy ${legacyKey} identify different values`,
			"operation-field-alias-ambiguous",
			{ canonicalKey, legacyKey, canonicalValue: canonical, legacyValue: legacy },
		);
	}
	return canonical ?? legacy;
}

function readAliasedString(
	record: Readonly<Record<string, unknown>>,
	canonicalKey: string,
	legacyKey: string,
): string | undefined {
	const canonical = record[canonicalKey];
	if (typeof canonical === "string" && canonical.trim()) return canonical.trim();
	const legacy = record[legacyKey];
	return typeof legacy === "string" && legacy.trim() ? legacy.trim() : undefined;
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
