import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ContentProjectCommand } from "../project/commands";
import { CONTENT_NODE_DEFINITIONS } from "../node/definitions";
import type { ContentNode, ContentNodeKind } from "../project/types";
import type { ContentCreationWorkspace } from "../project/workspace";
import { createContentCreationAgentState } from "./agent-state";

const TAB_ID = "workspace";
const SCOPE_USE = ["conversation", "project"] as const;
const NODE_KINDS: readonly ContentNodeKind[] = CONTENT_NODE_DEFINITIONS.map((definition) => definition.kind);

interface ProjectInput {
	projectDir?: string;
}

interface ApplyOperationsInput extends ProjectInput {
	expectedRevision?: number;
	operations: unknown[];
}

const projectDirProperty = {
	type: "string",
	description: "Optional absolute project directory. Defaults to the active conversation cwd.",
};

const applyOperationsSchema = {
	type: "object",
	properties: {
		projectDir: projectDirProperty,
		expectedRevision: {
			type: "number",
			description: "Project revision returned by content_creation_get_state. Use it to prevent stale writes.",
		},
		operations: {
			type: "array",
			minItems: 1,
			maxItems: 50,
			items: {
				type: "object",
				properties: {
					type: {
						type: "string",
						enum: [
							"add_node",
							"rename_node",
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
					name: { type: "string" },
					prompt: { type: "string" },
					aspectRatio: { type: "string" },
					quality: { type: "string" },
					resolution: { type: "string" },
					nodeId: { type: "string" },
					source: { type: "string" },
					target: { type: "string" },
					sourceHandle: { type: "string" },
					targetHandle: { type: "string" },
					edgeId: { type: "string" },
					trackId: { type: "string" },
					start: { type: "number" },
					duration: { type: "number" },
				},
				required: ["type"],
				additionalProperties: false,
			},
		},
	},
	required: ["operations"],
	additionalProperties: false,
};

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

function parseNodeData(record: Record<string, unknown>): ContentNode["data"] {
	const data: ContentNode["data"] = {};
	const prompt = optionalString(record, "prompt");
	const aspectRatio = optionalString(record, "aspectRatio");
	const quality = optionalString(record, "quality");
	const resolution = optionalString(record, "resolution");
	if (prompt !== undefined) {
		data.prompt = prompt;
		data.promptOptimization = undefined;
	}
	if (aspectRatio !== undefined) data.aspectRatio = aspectRatio;
	if (quality !== undefined) data.quality = quality;
	if (resolution !== undefined) data.resolution = resolution;
	if (typeof record.duration === "number" && Number.isFinite(record.duration)) data.duration = record.duration;
	return data;
}

function parseOperation(value: unknown): ContentProjectCommand {
	const operation = asRecord(value);
	const type = requiredString(operation, "type");
	switch (type) {
		case "add_node": {
			const kind = requiredString(operation, "kind");
			if (!NODE_KINDS.includes(kind as ContentNodeKind)) throw new Error(`unsupported node kind: ${kind}`);
			return {
				type: "node.add",
				node: {
					id: optionalString(operation, "id"),
					kind: kind as ContentNodeKind,
					name: optionalString(operation, "name"),
					position: { x: requiredNumber(operation, "x"), y: requiredNumber(operation, "y") },
					data: parseNodeData(operation),
				},
			};
		}
		case "rename_node":
			return {
				type: "node.rename",
				nodeId: requiredString(operation, "nodeId"),
				name: requiredString(operation, "name"),
			};
		case "update_node":
			return {
				type: "node.update",
				nodeId: requiredString(operation, "nodeId"),
				data: parseNodeData(operation),
			};
		case "delete_node":
			return { type: "node.delete", nodeId: requiredString(operation, "nodeId") };
		case "duplicate_node":
			return { type: "node.duplicate", nodeId: requiredString(operation, "nodeId") };
		case "connect_nodes":
			return {
				type: "edge.connect",
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

function resolveCwd(input: ProjectInput, sessionCwd: string): string {
	return input.projectDir?.trim() || sessionCwd;
}

export function registerContentCreationTools(ctx: PluginContext, workspace: ContentCreationWorkspace): void {
	ctx.agent.registerTool<ProjectInput>({
		id: "open-content-creation",
		name: "open_content_creation",
		label: "%tool.open.label%",
		description: "Open the content creation canvas and composition workspace for the active project.",
		parameters: {
			type: "object",
			properties: { projectDir: projectDirProperty },
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		handler: async ({ session, trigger }) => {
			const cwd = resolveCwd(trigger.input, session.cwd);
			const project = await workspace.load(cwd);
			ctx.ui.openActivityTab(TAB_ID, { width: "max" });
			return { ok: true, cwd, projectId: project.projectId, revision: project.revision };
		},
	});

	ctx.agent.registerTool<ProjectInput>({
		id: "get-content-creation-state",
		name: "content_creation_get_state",
		label: "%tool.getState.label%",
		description:
			"Read the current content-creation project state before editing it. Use the returned revision with content_creation_apply_operations.",
		parameters: {
			type: "object",
			properties: { projectDir: projectDirProperty },
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		handler: async ({ session, trigger }) => {
			const cwd = resolveCwd(trigger.input, session.cwd);
			return createContentCreationAgentState(await workspace.load(cwd), (key) => ctx.i18n.t(key));
		},
	});

	ctx.agent.registerTool<ApplyOperationsInput>({
		id: "apply-content-creation-operations",
		name: "content_creation_apply_operations",
		label: "%tool.apply.label%",
		description:
			"Apply a small atomic batch of structured operations to the content graph or composition timeline. Read state first and pass expectedRevision. The UI and this tool share the same command bus.",
		parameters: applyOperationsSchema,
		scope_use: SCOPE_USE,
		handler: async ({ session, trigger }) => {
			const cwd = resolveCwd(trigger.input, session.cwd);
			try {
				const commands = trigger.input.operations.map(parseOperation);
				const project = await workspace.dispatch(cwd, commands, trigger.input.expectedRevision);
				ctx.ui.openActivityTab(TAB_ID, { width: "max" });
				return {
					ok: true,
					projectId: project.projectId,
					revision: project.revision,
					nodeCount: project.graph.nodes.length,
					clipCount: project.timeline.tracks.reduce((count, track) => count + track.clips.length, 0),
				};
			} catch (error) {
				return {
					ok: false,
					retryable: true,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	});
}
