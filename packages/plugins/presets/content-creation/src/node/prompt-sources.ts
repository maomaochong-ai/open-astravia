import type {
	ContentAsset,
	ContentNode,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentProjectDocument,
} from "../project/types";
import { isContentInputBindingAvailable } from "./material-assets";
import {
	contentPromptTextFromData,
	listContentPromptBindingIds,
	listContentPromptSourceNodeIds,
} from "./prompt-document";

export const PROMPT_REFERENCE_SLOT_ID = "promptReferences";

export interface ContentPromptReference {
	binding: ContentNodeInputBinding;
	asset: ContentAsset;
}

export interface ConnectedPromptSource {
	nodeId: string;
	label?: string;
	prompt: string;
	references: readonly ContentPromptReference[];
}

export function listContentPromptReferences(
	project: ContentProjectDocument,
	node: Pick<ContentNode, "id" | "data">,
): ContentPromptReference[] {
	const bindings = node.data.promptDocument
		? listContentPromptBindingIds(node.data.promptDocument).flatMap((bindingId) => {
				const binding = node.data.inputs?.find((candidate) => candidate.id === bindingId);
				return binding ? [binding] : [];
			})
		: (node.data.inputs ?? []);
	return bindings.flatMap((binding) => {
		if (!isContentInputBindingAvailable(project, node.id, binding)) return [];
		const asset = project.assets.find((candidate) => candidate.id === binding.assetId);
		return asset ? [{ binding, asset }] : [];
	});
}

export function listConnectedPromptSources(
	project: ContentProjectDocument,
	targetNodeId: string,
): ConnectedPromptSource[] {
	return project.graph.edges
		.filter((edge) => edge.target === targetNodeId && edge.targetHandle === "prompt")
		.flatMap((edge) => {
			const source = project.graph.nodes.find(
				(node) => node.id === edge.source && node.kind === "prompt",
			);
			if (!source) return [];
			return [
				{
					nodeId: source.id,
					label: source.data.label,
					prompt: contentPromptTextFromData(source.data),
					references: listContentPromptReferences(project, source),
				},
			];
		});
}

export function resolveConnectedPromptSource(
	sources: readonly ConnectedPromptSource[],
	data: ContentNodeData,
): ConnectedPromptSource | null {
	return resolveConnectedPromptSources(sources, data)[0] ?? null;
}

export function resolveConnectedPromptSources(
	sources: readonly ConnectedPromptSource[],
	data: ContentNodeData,
): ConnectedPromptSource[] {
	if (data.promptDocument) {
		return listContentPromptSourceNodeIds(data.promptDocument).flatMap((sourceNodeId) => {
			const source = sources.find((candidate) => candidate.nodeId === sourceNodeId);
			return source ? [source] : [];
		});
	}
	if (data.promptSourceNodeId === null) return [];
	if (data.promptSourceNodeId) {
		const source = sources.find((candidate) => candidate.nodeId === data.promptSourceNodeId);
		return source ? [source] : [];
	}
	if (contentPromptTextFromData(data)) return [];
	return sources[0] ? [sources[0]] : [];
}

export function resolveContentPrompt(
	sources: readonly ConnectedPromptSource[],
	data: ContentNodeData,
): string {
	if (data.promptDocument) {
		return data.promptDocument.segments
			.flatMap((segment) => {
				if (segment.type === "text") return [segment.text];
				if (segment.type === "asset-reference") return [];
				return [sources.find((source) => source.nodeId === segment.sourceNodeId)?.prompt ?? ""];
			})
			.join("")
			.trim();
	}
	return resolveConnectedPromptSource(sources, data)?.prompt.trim() ?? contentPromptTextFromData(data);
}
