import { getContentNodeDefinition } from "../node/definitions";
import { listConnectedPromptSources, resolveContentPrompt } from "../node/prompt-sources";
import type { ContentProjectDocument } from "../project/types";

type Translate = (key: string) => string;

export function createContentCreationAgentState(project: ContentProjectDocument, t: Translate) {
	return {
		schemaVersion: project.schemaVersion,
		revision: project.revision,
		projectId: project.projectId,
		nodes: project.graph.nodes.map((node) => {
			const definition = getContentNodeDefinition(node.kind);
			return {
				id: node.id,
				name: node.name?.trim() || node.kind,
				kind: node.kind,
				description: t(definition.descriptionKey),
				status: node.status,
				layout: {
					x: node.position.x,
					y: node.position.y,
					width: node.width,
					height: node.height,
					locked: Boolean(node.locked),
				},
				ports: {
					inputs: definition.inputs.map(({ id, dataType, multiple }) => ({ id, dataType, multiple: Boolean(multiple) })),
					outputs: definition.outputs.map(({ id, dataType, multiple }) => ({ id, dataType, multiple: Boolean(multiple) })),
				},
				settings: structuredClone(node.data),
				effectivePrompt:
					node.kind === "prompt" || node.kind === "image-generator" || node.kind === "video-generator"
						? resolveContentPrompt(listConnectedPromptSources(project, node.id), node.data)
						: undefined,
			};
		}),
		connections: project.graph.edges.map((edge) => ({
			id: edge.id,
			from: { nodeId: edge.source, port: edge.sourceHandle },
			to: { nodeId: edge.target, port: edge.targetHandle },
		})),
		assets: project.assets.map((asset) => ({
			id: asset.id,
			name: asset.name,
			kind: asset.kind,
			mimeType: asset.mimeType,
			location: asset.filePath ? { type: "workspace-file", path: asset.filePath } : { type: "managed-import" },
			duration: asset.duration,
			width: asset.width,
			height: asset.height,
			createdAt: asset.createdAt,
		})),
		timeline: structuredClone(project.timeline),
	};
}
