import {
	CONTENT_GENERATION_SOURCE_ROLES,
	CONTENT_VIDEO_GENERATION_INTENTS,
} from "../generation/generation-intent";
import type { ContentNodeKind, ContentWorkflowDeliverable } from "../project/types";
import { VIDEO_PROMPT_PLAN_SCHEMA } from "./generation-prompt-plan";
import { KEYFRAME_PROMPT_PLAN_SCHEMA } from "./keyframe-prompt-plan";
import {
	CONTENT_VIDEO_REFERENCE_SEMANTIC_ROLES,
	CONTENT_VIDEO_SHOT_STRATEGIES,
} from "./video-shot-plan";

const TARGET_INPUT = {
	type: "string",
	description:
		"Semantic target input. Use promptSources, referenceImages, contentSources, or mediaSources; never use internal port handles.",
} as const;

const MODEL_SELECTION_PROPERTIES = {
	modelSelection: { type: "string", enum: ["automatic", "specific"] },
	providerId: { type: "string" },
	modelId: { type: "string" },
	modeId: { type: "string" },
} as const;

const NODE_DATA_PROPERTIES = {
	prompt: { type: "string" },
	promptPlan: { anyOf: [VIDEO_PROMPT_PLAN_SCHEMA, KEYFRAME_PROMPT_PLAN_SCHEMA] },
	aspectRatio: { type: "string" },
	quality: { type: "string" },
	resolution: { type: "string" },
	duration: { type: "number" },
	assetIds: { type: "array", items: { type: "string" } },
	...MODEL_SELECTION_PROPERTIES,
} as const;

const LOW_LEVEL_SOURCE_SCHEMA = {
	type: "object",
	properties: {
		sourceNodeId: { type: "string", minLength: 1 },
		assetIds: { type: "array", items: { type: "string" } },
		role: { type: "string", enum: CONTENT_GENERATION_SOURCE_ROLES },
	},
	required: ["sourceNodeId"],
	additionalProperties: false,
} as const;

const HIGH_LEVEL_SOURCE_SCHEMA = {
	type: "object",
	properties: {
		sourceNodeId: { type: "string", minLength: 1 },
		assetIds: { type: "array", items: { type: "string" } },
		alias: { type: "string", minLength: 1 },
		semanticRole: { type: "string", enum: CONTENT_VIDEO_REFERENCE_SEMANTIC_ROLES },
		instruction: { type: "string", minLength: 1 },
	},
	required: ["sourceNodeId"],
	additionalProperties: false,
} as const;

const KEYFRAME_SCHEMA = {
	type: "object",
	properties: {
		nodeId: { type: "string", minLength: 1 },
		promptPlan: KEYFRAME_PROMPT_PLAN_SCHEMA,
	},
	required: ["nodeId", "promptPlan"],
	additionalProperties: false,
} as const;

function operation(type: string, properties: Record<string, unknown>, required: readonly string[]) {
	return {
		type: "object",
		properties: { type: { const: type }, ...properties },
		required: ["type", ...required],
		additionalProperties: false,
	} as const;
}

export const CONTENT_AGENT_OPERATION_TYPES = [
	"update_workflow",
	"add_node",
	"rename_node",
	"set_node_purpose",
	"update_node",
	"duplicate_node",
	"bind_assets",
	"configure_generation",
	"configure_video_shot",
	"delete_node",
	"connect_nodes",
	"delete_edge",
] as const;

export function createContentAgentOperationSchema(
	nodeKinds: readonly ContentNodeKind[],
	deliverableTypes: readonly ContentWorkflowDeliverable["type"][],
) {
	const deliverables = {
		type: "array",
		items: {
			type: "object",
			properties: {
				type: { type: "string", enum: deliverableTypes },
				fromNode: { type: "string", minLength: 1 },
				description: { type: "string", minLength: 1 },
			},
			required: ["type", "fromNode", "description"],
			additionalProperties: false,
		},
	} as const;
	const videoShot = operation("configure_video_shot", {
			targetNodeId: {
				type: "string",
				minLength: 1,
				description: "Receiving video-generator node. Media inputs belong in sources or keyframes.",
			},
			strategy: { type: "string", enum: CONTENT_VIDEO_SHOT_STRATEGIES },
			controlRequirements: {
				type: "object",
				properties: {
					exactOpening: { type: "boolean" },
					exactEnding: {
						type: "boolean",
						description:
							"Hard final-frame anchor. Set true only when distinct first and last keyframe plans are supplied; a stable finalState alone does not require this.",
					},
					requiresSceneReference: { type: "boolean" },
				},
				additionalProperties: false,
			},
			sources: {
				type: "array",
				description:
					"High-level semantic media sources. Do not add raw media connect_nodes operations and do not send low-level role fields.",
				items: HIGH_LEVEL_SOURCE_SCHEMA,
			},
			keyframes: {
				type: "object",
				properties: { first: KEYFRAME_SCHEMA, last: KEYFRAME_SCHEMA },
				additionalProperties: false,
			},
			promptPlan: VIDEO_PROMPT_PLAN_SCHEMA,
			aspectRatio: { type: "string" },
			duration: { type: "number" },
			...MODEL_SELECTION_PROPERTIES,
		}, ["targetNodeId", "promptPlan"]);

	return {
		type: "array",
		minItems: 1,
		maxItems: 50,
		items: {
			oneOf: [
				{
					...operation("update_workflow", {
						title: { type: "string" },
						objective: { type: "string" },
						deliverables,
					}, []),
					minProperties: 2,
				},
				operation("add_node", {
					id: { type: "string", minLength: 1 },
					kind: { type: "string", enum: nodeKinds },
					afterNodeId: { type: "string", minLength: 1 },
					name: { type: "string" },
					purpose: { type: "string" },
					...NODE_DATA_PROPERTIES,
				}, ["kind"]),
				operation("rename_node", {
					nodeId: { type: "string", minLength: 1 },
					name: { type: "string", minLength: 1 },
				}, ["nodeId", "name"]),
				operation("set_node_purpose", {
					nodeId: { type: "string", minLength: 1 },
					purpose: { type: "string", minLength: 1 },
				}, ["nodeId", "purpose"]),
				{
					...operation("update_node", {
						nodeId: { type: "string", minLength: 1 },
						...NODE_DATA_PROPERTIES,
					}, ["nodeId"]),
					minProperties: 3,
				},
				operation("duplicate_node", {
					nodeId: { type: "string", minLength: 1 },
					id: { type: "string", minLength: 1 },
				}, ["nodeId"]),
				operation("bind_assets", {
					sourceNodeId: { type: "string", minLength: 1 },
					targetNodeId: { type: "string", minLength: 1 },
					assetIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
					targetInput: TARGET_INPUT,
				}, ["sourceNodeId", "targetNodeId", "assetIds", "targetInput"]),
				operation("configure_generation", {
					targetNodeId: { type: "string", minLength: 1 },
					generationIntent: { type: "string", enum: CONTENT_VIDEO_GENERATION_INTENTS },
					sources: { type: "array", items: LOW_LEVEL_SOURCE_SCHEMA },
					...MODEL_SELECTION_PROPERTIES,
				}, ["targetNodeId", "generationIntent"]),
				videoShot,
				operation("delete_node", {
					nodeId: { type: "string", minLength: 1 },
				}, ["nodeId"]),
				operation("connect_nodes", {
					edgeId: { type: "string", minLength: 1 },
					sourceNodeId: { type: "string", minLength: 1 },
					targetNodeId: { type: "string", minLength: 1 },
					targetInput: TARGET_INPUT,
				}, ["sourceNodeId", "targetNodeId"]),
				operation("delete_edge", {
					edgeId: { type: "string", minLength: 1 },
				}, ["edgeId"]),
			],
		},
	} as const;
}
