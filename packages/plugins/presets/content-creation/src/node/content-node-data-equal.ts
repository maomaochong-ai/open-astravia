import type { ContentNodeData, ContentNodeInputBinding } from "../project/types";
import { contentPromptDocumentsEqual } from "./prompt-document";

export function contentNodeDataEqual(left: ContentNodeData, right: ContentNodeData): boolean {
	return (
		left.prompt === right.prompt &&
		optionalPromptDocumentsEqual(left.promptDocument, right.promptDocument) &&
		promptOptimizationsEqual(left.promptOptimization, right.promptOptimization) &&
		left.assetId === right.assetId &&
		stringArraysEqual(left.assetIds, right.assetIds) &&
		left.aspectRatio === right.aspectRatio &&
		left.quality === right.quality &&
		left.duration === right.duration &&
		left.resolution === right.resolution &&
		left.providerId === right.providerId &&
		left.modelId === right.modelId &&
		left.modeId === right.modeId &&
		(left.promptSourceNodeId ?? null) === (right.promptSourceNodeId ?? null) &&
		inputBindingsEqual(left.inputs, right.inputs)
	);
}

function promptOptimizationsEqual(
	left: ContentNodeData["promptOptimization"],
	right: ContentNodeData["promptOptimization"],
): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return (
		left.text === right.text &&
		left.modelKey === right.modelKey &&
		left.createdAt === right.createdAt
	);
}

function optionalPromptDocumentsEqual(
	left: ContentNodeData["promptDocument"],
	right: ContentNodeData["promptDocument"],
): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return contentPromptDocumentsEqual(left, right);
}

function stringArraysEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
	if (left === right) return true;
	if ((left?.length ?? 0) === 0 && (right?.length ?? 0) === 0) return true;
	if (!left || !right || left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function inputBindingsEqual(
	left: readonly ContentNodeInputBinding[] | undefined,
	right: readonly ContentNodeInputBinding[] | undefined,
): boolean {
	if (left === right) return true;
	if ((left?.length ?? 0) === 0 && (right?.length ?? 0) === 0) return true;
	if (!left || !right || left.length !== right.length) return false;
	return left.every((binding, index) => {
		const candidate = right[index];
		return (
			candidate !== undefined &&
			binding.id === candidate.id &&
			binding.assetId === candidate.assetId &&
			binding.slotId === candidate.slotId &&
			binding.sourceNodeId === candidate.sourceNodeId
		);
	});
}
