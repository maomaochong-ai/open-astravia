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

const NODE_KINDS: readonly ContentNodeKind[] = CONTENT_NODE_DEFINITIONS.map((definition) => definition.kind);
const DELIVERABLE_TYPES: readonly ContentWorkflowDeliverable["type"][] = [
	"image",
	"video",
	"audio",
	"text",
	"content",
];

const AGENT_TARGET_INPUTS = [
	"mediaSources",
	"promptSources",
	"referenceImages",
	"contentSources",
] as const;

type AgentTargetInput = (typeof AGENT_TARGET_INPUTS)[number];

export const CONTENT_AGENT_OPERATION_SCHEMA = {
	type: "array",
	minItems: 1,
	maxItems: 50,
	items: {
		type: "object",
		properties: {
			type: {
				type: "string",
				enum: [
					"update_workflow",
					"add_node",
					"rename_node",
					"set_node_purpose",
					"update_node",
					"duplicate_node",
					"bind_assets",
					"configure_generation",
					"delete_node",
					"connect_nodes",
					"delete_edge",
				],
			},
			id: { type: "string" },
			kind: { type: "string", enum: NODE_KINDS },
			x: { type: "number" },
			y: { type: "number" },
			afterNodeId: {
				type: "string",
				description: "Place a new node after this node. Prefer this or automatic placement over canvas coordinates.",
			},
			name: { type: "string" },
			title: { type: "string" },
			objective: { type: "string" },
			purpose: { type: "string" },
			assetIds: { type: "array", items: { type: "string" } },
			generationIntent: { type: "string", enum: CONTENT_VIDEO_GENERATION_INTENTS },
			sources: {
				type: "array",
				items: {
					type: "object",
					properties: {
						sourceNodeId: { type: "string" },
						assetIds: { type: "array", items: { type: "string" } },
						role: { type: "string", enum: CONTENT_GENERATION_SOURCE_ROLES },
					},
					required: ["sourceNodeId"],
					additionalProperties: false,
				},
			},
			deliverables: {
				type: "array",
				items: {
					type: "object",
					properties: {
						type: { type: "string", enum: DELIVERABLE_TYPES },
						fromNode: { type: "string" },
						description: { type: "string" },
					},
					required: ["type", "fromNode", "description"],
					additionalProperties: false,
				},
			},
			prompt: { type: "string" },
			aspectRatio: { type: "string" },
			quality: { type: "string" },
			resolution: { type: "string" },
			duration: { type: "number" },
			modelSelection: { type: "string", enum: ["automatic", "specific"] },
			providerId: { type: "string" },
			modelId: { type: "string" },
			modeId: { type: "string" },
			nodeId: { type: "string" },
			source: { type: "string" },
			target: { type: "string" },
			targetInput: {
				type: "string",
				enum: AGENT_TARGET_INPUTS,
				description:
					"Optional semantic target input. Omit when source and target types identify one valid input.",
			},
			edgeId: { type: "string" },
		},
		required: ["type"],
		additionalProperties: false,
	},
} as const;

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
	return values.map((value) => parseOperation(value, project, frames, nodeKinds, nodeSnapshots, models));
}

function parseOperation(
	value: unknown,
	project: ContentProjectDocument,
	frames: PlacementFrame[],
	nodeKinds: Map<string, ContentNodeKind>,
	nodeSnapshots: Map<string, ContentNode>,
	models: readonly ContentModelDescriptor[],
): ContentProjectCommand {
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
			const data = parseNodeData(operation);
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
			const data = parseNodeData(operation);
			const snapshot = nodeSnapshots.get(nodeId);
			if (!snapshot) throw new Error(`node not found: ${nodeId}`);
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
			};
		}
		case "connect_nodes": {
			const source = requiredString(operation, "source");
			const target = requiredString(operation, "target");
			const targetKind = nodeKinds.get(target);
			const sourceKind = nodeKinds.get(source);
			if (!sourceKind) throw new Error(`node not found: ${source}`);
			if (!targetKind) throw new Error(`node not found: ${target}`);
			const targetInput = optionalAgentTargetInput(operation.targetInput);
			if (targetKind === "video-generator" && sourceKind !== "prompt") {
				throw new ContentGenerationIntentError(
					"media inputs for generation nodes must use configure_generation so their business role is explicit",
					"generation-semantic-connection-required",
					{ sourceNodeId: source, targetNodeId: target },
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
				id: optionalString(operation, "id")?.trim() || crypto.randomUUID(),
				source,
				target,
				targetHandle: targetInput ? targetHandleForAgentInput(targetKind, targetInput) : undefined,
				...(targetKind === "image-generator" && sourceKind === "image-generator"
					? { role: "referenceImages" }
					: {}),
			};
		}
		case "bind_assets": {
			const source = requiredString(operation, "source");
			const target = requiredString(operation, "target");
			if (nodeKinds.get(source) !== "asset") throw new Error("bind_assets source must be an asset node");
			const targetKind = nodeKinds.get(target);
			if (targetKind !== "image-generator") {
				throw new ContentGenerationIntentError(
					"video generator media inputs must use configure_generation",
					"generation-semantic-connection-required",
					{ sourceNodeId: source, targetNodeId: target },
				);
			}
			const targetInput = optionalAgentTargetInput(operation.targetInput);
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
			const targetNodeId = requiredString(operation, "nodeId");
			const target = nodeSnapshots.get(targetNodeId);
			if (!target) throw new Error(`node not found: ${targetNodeId}`);
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
		case "delete_edge":
			return { type: "edge.delete", edgeId: requiredString(operation, "edgeId") };
		default:
			throw new Error(`unsupported operation type: ${type}`);
	}
}

function optionalAgentTargetInput(value: unknown): AgentTargetInput | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !AGENT_TARGET_INPUTS.includes(value as AgentTargetInput)) {
		throw new Error("targetInput is not supported");
	}
	return value as AgentTargetInput;
}

function targetHandleForAgentInput(kind: ContentNodeKind, input: AgentTargetInput): string {
	const mapping: Partial<Record<ContentNodeKind, Partial<Record<AgentTargetInput, string>>>> = {
		prompt: { mediaSources: "media" },
		"image-generator": { promptSources: "prompt", referenceImages: "reference" },
		"video-generator": { promptSources: "prompt" },
		output: { contentSources: "content" },
	};
	const handle = mapping[kind]?.[input];
	if (!handle) throw new Error(`targetInput ${input} is not valid for ${kind}`);
	return handle;
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

function parseNodeData(record: Record<string, unknown>): ContentNode["data"] {
	const data: ContentNode["data"] = {};
	copyOptionalString(record, data, "prompt");
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
	if (record.duration !== undefined) data.duration = requiredNumber(record, "duration");
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
	const x = record.x;
	const y = record.y;
	if (x !== undefined || y !== undefined) {
		if (x === undefined || y === undefined) throw new Error("x and y must be provided together");
		return { x: requiredNumber(record, "x"), y: requiredNumber(record, "y") };
	}
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
