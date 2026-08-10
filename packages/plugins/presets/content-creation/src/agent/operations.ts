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
					"delete_node",
					"connect_nodes",
					"delete_edge",
					"add_timeline_clip",
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
			sourceHandle: { type: "string" },
			targetHandle: { type: "string" },
			edgeId: { type: "string" },
			trackId: { type: "string" },
			start: { type: "number" },
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
): ContentProjectCommand[] {
	const frames = project.graph.nodes.map(toPlacementFrame);
	return values.map((value) => parseOperation(value, frames));
}

export function contentAgentOperationsAreDestructive(commands: readonly ContentProjectCommand[]): boolean {
	return commands.some((command) => command.type === "node.delete" || command.type === "edge.delete");
}

function parseOperation(value: unknown, frames: PlacementFrame[]): ContentProjectCommand {
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
		case "update_node":
			return { type: "node.update", nodeId: requiredString(operation, "nodeId"), data: parseNodeData(operation) };
		case "delete_node":
			return { type: "node.delete", nodeId: requiredString(operation, "nodeId") };
		case "duplicate_node":
			return {
				type: "node.duplicate",
				nodeId: requiredString(operation, "nodeId"),
				id: optionalString(operation, "id")?.trim() || crypto.randomUUID(),
			};
		case "connect_nodes":
			return {
				type: "edge.connect",
				id: optionalString(operation, "id")?.trim() || crypto.randomUUID(),
				source: requiredString(operation, "source"),
				target: requiredString(operation, "target"),
				sourceHandle: optionalString(operation, "sourceHandle"),
				targetHandle: optionalString(operation, "targetHandle"),
			};
		case "delete_edge":
			return { type: "edge.delete", edgeId: requiredString(operation, "edgeId") };
		case "add_timeline_clip":
			return {
				type: "timeline.clip.add",
				clip: {
					id: optionalString(operation, "id")?.trim() || crypto.randomUUID(),
					trackId: optionalString(operation, "trackId") ?? "video-1",
					sourceNodeId: requiredString(operation, "nodeId"),
					start: requiredNumber(operation, "start"),
					duration: requiredNumber(operation, "duration"),
					sourceIn: 0,
					speed: 1,
				},
			};
		default:
			throw new Error(`unsupported operation type: ${type}`);
	}
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
