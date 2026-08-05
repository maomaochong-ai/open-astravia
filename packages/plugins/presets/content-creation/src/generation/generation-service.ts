import type {
	AssetKind,
	ContentAsset,
	ContentNode,
	ContentNodeInputBinding,
	ContentProjectDocument,
} from "../project/types";
import { isContentInputBindingAvailable, listContentNodeAssetIds } from "../node/material-assets";
import {
	listConnectedPromptSources,
	PROMPT_REFERENCE_SLOT_ID,
	resolveConnectedPromptSources,
	resolveContentPrompt,
	type ConnectedPromptSource,
} from "../node/prompt-sources";
import {
	appendContentPromptReferences,
	createContentPromptDocument,
} from "../node/prompt-document";
import type { ContentCreationWorkspace } from "../project/workspace";
import {
	assignContentReferenceSlots,
	listAcceptedReferenceKinds,
	outputKindForNodeKind,
	slotIdForReferenceKind,
	type ContentReferenceShape,
} from "./model-inputs";
import type { ContentProviderRegistry } from "./provider-registry";
import type {
	ContentArtifactStore,
	ContentGenerationOutputKind,
	ContentGenerationReference,
	ContentModelDescriptor,
	ImportedContentAsset,
	ImportedContentReference,
} from "./types";

function requireNode(project: ContentProjectDocument, nodeId: string): ContentNode {
	const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`content node not found: ${nodeId}`);
	return node;
}

interface ReferenceCandidate {
	id: string;
	asset: ContentAsset;
	slotId?: string;
}

export class ContentGenerationService {
	constructor(
		private readonly workspace: ContentCreationWorkspace,
		private readonly providers: ContentProviderRegistry,
		private readonly artifacts: ContentArtifactStore,
	) {}

	listModels(outputKind?: ContentGenerationOutputKind): ContentModelDescriptor[] {
		return this.providers.listModels(outputKind);
	}

	async importAssets(
		cwd: string | null,
		nodeId: string,
		files: readonly ImportedContentAsset[],
	): Promise<ContentProjectDocument> {
		if (files.length === 0) return await this.workspace.load(cwd);
		const project = await this.workspace.load(cwd);
		const node = requireNode(project, nodeId);
		if (node.kind !== "asset") throw new Error(`node does not accept content assets: ${node.kind}`);

		const pending: Array<{ asset: ContentAsset; file: ImportedContentAsset }> = [];
		for (const file of files) {
			const kind = assetKindForMimeType(file.mimeType);
			if (!kind) throw new Error(`unsupported content asset type: ${file.mimeType}`);
			const assetId = crypto.randomUUID();
			pending.push({
				file,
				asset: {
					id: assetId,
					blobId: assetId,
					kind,
					name: file.name.trim() || `${kind}-${assetId.slice(0, 8)}.${extensionForMimeType(file.mimeType)}`,
					mimeType: file.mimeType,
					createdAt: new Date().toISOString(),
				},
			});
		}

		for (const item of pending) {
			const stored = await this.artifacts.put(item.asset.id, item.file);
			item.asset.blobId = stored.id;
			item.asset.mimeType = stored.mimeType;
		}
		const assetIds = [...listContentNodeAssetIds(node.data), ...pending.map(({ asset }) => asset.id)];
		return await this.workspace.dispatch(cwd, [
			...pending.map(({ asset }) => ({ type: "asset.add" as const, asset })),
			{ type: "node.update", nodeId, data: { assetId: undefined, assetIds } },
		]);
	}

	async importReferences(
		cwd: string | null,
		nodeId: string,
		files: readonly ImportedContentReference[],
	): Promise<ContentProjectDocument> {
		if (files.length === 0) return await this.workspace.load(cwd);
		const project = await this.workspace.load(cwd);
		const node = requireNode(project, nodeId);
		if (node.kind === "prompt") {
			return await this.importPromptReferences(cwd, node, files);
		}
		const outputKind = requireOutputKind(node);
		const existingBindings = node.data.inputs ?? [];
		const promptSources = listConnectedPromptSources(project, node.id);
		const selectedPrompts = resolveConnectedPromptSources(promptSources, node.data);
		const existingCandidates = listGenerationReferenceCandidates(project, node, selectedPrompts);
		const fixedShapes = referenceShapes(existingCandidates.filter((candidate) => candidate.slotId));
		const promptKinds = existingCandidates.filter((candidate) => !candidate.slotId).map(({ asset }) => asset.kind);
		const model = findSelectedModel(this.listModels(outputKind), node, fixedShapes, promptKinds);
		if (!model) throw new Error("no compatible content model is configured");

		const currentAssignment = assignContentReferenceSlots(model, fixedShapes, promptKinds, node.data.modeId);
		const nextShapes = [...currentAssignment.references];
		const pending: Array<{
			asset: ContentAsset;
			binding: ContentNodeInputBinding;
			file: ImportedContentReference;
		}> = [];
		for (const file of files) {
			const kind = assetKindForMimeType(file.mimeType);
			if (!kind || !listAcceptedReferenceKinds(model, nextShapes).includes(kind)) {
				throw new Error(`content model does not accept ${file.mimeType}: ${model.providerId}/${model.modelId}`);
			}
			const slotId = slotIdForReferenceKind(model, nextShapes, kind);
			if (!slotId) throw new Error(`content model input capacity exceeded: ${model.providerId}/${model.modelId}`);
			const assetId = crypto.randomUUID();
			const binding = { id: crypto.randomUUID(), assetId, slotId };
			pending.push({
				file,
				binding,
				asset: {
					id: assetId,
					blobId: assetId,
					kind,
					name: file.name.trim() || `${kind}-${assetId.slice(0, 8)}.${extensionForMimeType(file.mimeType)}`,
					mimeType: file.mimeType,
					createdAt: new Date().toISOString(),
				},
			});
			nextShapes.push({ slotId, kind });
		}

		for (const item of pending) {
			const stored = await this.artifacts.put(item.asset.id, item.file);
			item.asset.blobId = stored.id;
			item.asset.mimeType = stored.mimeType;
		}
		return await this.workspace.dispatch(cwd, [
			...pending.map(({ asset }) => ({ type: "asset.add" as const, asset })),
			{
				type: "node.update",
				nodeId,
				data: {
					providerId: model.providerId,
					modelId: model.modelId,
					inputs: [...existingBindings, ...pending.map(({ binding }) => binding)],
				},
			},
		]);
	}

	private async importPromptReferences(
		cwd: string | null,
		node: ContentNode,
		files: readonly ImportedContentReference[],
	): Promise<ContentProjectDocument> {
		const pending: Array<{
			asset: ContentAsset;
			binding: ContentNodeInputBinding;
			file: ImportedContentReference;
		}> = [];
		for (const file of files) {
			const kind = assetKindForMimeType(file.mimeType);
			if (!kind) throw new Error(`unsupported content asset type: ${file.mimeType}`);
			const assetId = crypto.randomUUID();
			pending.push({
				file,
				binding: { id: crypto.randomUUID(), assetId, slotId: PROMPT_REFERENCE_SLOT_ID },
				asset: {
					id: assetId,
					blobId: assetId,
					kind,
					name: file.name.trim() || `${kind}-${assetId.slice(0, 8)}.${extensionForMimeType(file.mimeType)}`,
					mimeType: file.mimeType,
					createdAt: new Date().toISOString(),
				},
			});
		}
		for (const item of pending) {
			const stored = await this.artifacts.put(item.asset.id, item.file);
			item.asset.blobId = stored.id;
			item.asset.mimeType = stored.mimeType;
		}
		return await this.workspace.dispatch(cwd, [
			...pending.map(({ asset }) => ({ type: "asset.add" as const, asset })),
			{
				type: "node.update",
				nodeId: node.id,
				data: {
					inputs: [...(node.data.inputs ?? []), ...pending.map(({ binding }) => binding)],
					promptDocument: appendContentPromptReferences(
						createContentPromptDocument(node.data),
						pending.map(({ binding }) => binding.id),
					),
				},
			},
		]);
	}

	async runNode(cwd: string | null, nodeId: string): Promise<ContentProjectDocument> {
		const project = await this.workspace.load(cwd);
		const node = requireNode(project, nodeId);
		const outputKind = requireOutputKind(node);
		if (node.status === "running" || node.status === "queued") throw new Error(`node is already running: ${nodeId}`);
		const promptSources = listConnectedPromptSources(project, node.id);
		const selectedPrompts = resolveConnectedPromptSources(promptSources, node.data);
		const prompt = resolveContentPrompt(promptSources, node.data);
		if (!prompt) throw new Error("content generation requires a prompt");
		const candidates = listGenerationReferenceCandidates(project, node, selectedPrompts);
		const fixedShapes = referenceShapes(candidates.filter((candidate) => candidate.slotId));
		const unassignedKinds = candidates.filter((candidate) => !candidate.slotId).map(({ asset }) => asset.kind);
		const model = findSelectedModel(this.listModels(outputKind), node, fixedShapes, unassignedKinds);
		if (!model) throw new Error("no compatible content model is configured");
		const assignment = assignContentReferenceSlots(model, fixedShapes, unassignedKinds, node.data.modeId);
		const mode = assignment.mode;
		if (!mode) throw new Error(`content model inputs are incompatible: ${model.providerId}/${model.modelId}`);
		const references = await this.resolveReferences(candidates, assignment.assignedSlotIds);
		const jobId = crypto.randomUUID();
		const assetId = crypto.randomUUID();

		await this.workspace.dispatch(cwd, [
			{
				type: "node.update",
				nodeId,
				data: { providerId: model.providerId, modelId: model.modelId, modeId: mode.id },
			},
			{ type: "job.start", job: { id: jobId, nodeId, providerId: model.providerId, modelId: model.modelId } },
		]);
		try {
			const generated = await this.providers.generate({
				modeId: mode.id,
				providerId: model.providerId,
				modelId: model.modelId,
				prompt,
				aspectRatio: node.data.aspectRatio,
				quality: node.data.quality,
				duration: node.data.duration,
				resolution: node.data.resolution,
				references,
			});
			const stored = await this.artifacts.put(assetId, generated);
			return await this.workspace.dispatch(cwd, [
				{
					type: "job.succeed",
					jobId,
					asset: {
						id: assetId,
						blobId: stored.id,
						kind: generated.kind,
						name: `${node.data.label?.trim() || `${generated.kind}-${assetId.slice(0, 8)}`}.${extensionForMimeType(generated.mimeType)}`,
						mimeType: stored.mimeType,
						duration: generated.duration,
						width: generated.width,
						height: generated.height,
						createdAt: new Date().toISOString(),
					},
				},
			]);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.workspace.dispatch(cwd, [{ type: "job.fail", jobId, error: message }]);
			throw error;
		}
	}

	private async resolveReferences(
		candidates: readonly ReferenceCandidate[],
		assignedSlotIds: readonly string[],
	): Promise<ContentGenerationReference[]> {
		let unassignedIndex = 0;
		return await Promise.all(
			candidates.map(async (candidate) => {
				const slotId = candidate.slotId ?? assignedSlotIds[unassignedIndex++];
				if (!slotId) throw new Error(`content reference slot not resolved: ${candidate.asset.id}`);
				const asset = candidate.asset;
				const stored = await this.artifacts.read(asset.blobId);
				if (!stored) throw new Error(`content reference data not found: ${asset.id}`);
				return { id: candidate.id, slotId, kind: asset.kind, ...stored };
			}),
		);
	}
}

function requireOutputKind(node: ContentNode): ContentGenerationOutputKind {
	const outputKind = outputKindForNodeKind(node.kind);
	if (!outputKind) throw new Error(`node is not executable: ${node.kind}`);
	return outputKind;
}

function findSelectedModel(
	models: readonly ContentModelDescriptor[],
	node: ContentNode,
	fixedReferences: readonly ContentReferenceShape[],
	unassignedKinds: readonly AssetKind[],
): ContentModelDescriptor | undefined {
	const selected = models.find(
		(model) => model.providerId === node.data.providerId && model.modelId === node.data.modelId,
	);
	if (selected) return selected;
	return models.find(
		(model) =>
			assignContentReferenceSlots(model, fixedReferences, unassignedKinds, node.data.modeId).mode !== null,
	);
}

function listGenerationReferenceCandidates(
	project: ContentProjectDocument,
	node: ContentNode,
	promptSources: readonly ConnectedPromptSource[],
): ReferenceCandidate[] {
	const candidates: ReferenceCandidate[] = (node.data.inputs ?? []).flatMap((binding) => {
		if (!isContentInputBindingAvailable(project, node.id, binding)) return [];
		const asset = project.assets.find((candidate) => candidate.id === binding.assetId);
		return asset ? [{ id: binding.id, asset, slotId: binding.slotId }] : [];
	});
	for (const edge of project.graph.edges.filter((candidate) => candidate.target === node.id)) {
		if (edge.targetHandle === "prompt") continue;
		const source = project.graph.nodes.find((candidate) => candidate.id === edge.source);
		const asset = source?.data.assetId
			? project.assets.find((candidate) => candidate.id === source.data.assetId)
			: undefined;
		if (!asset || (asset.kind !== "image" && asset.kind !== "video")) continue;
		candidates.push({
			id: `edge:${edge.id}`,
			asset,
			slotId: asset.kind === "image" ? "referenceImages" : "referenceVideo",
		});
	}
	for (const promptSource of promptSources) {
		for (const { binding, asset } of promptSource.references) {
			candidates.push({ id: `prompt:${promptSource.nodeId}:${binding.id}`, asset });
		}
	}
	return candidates.filter(
		(candidate, index) => candidates.findIndex((current) => current.asset.id === candidate.asset.id) === index,
	);
}

function referenceShapes(candidates: readonly ReferenceCandidate[]): ContentReferenceShape[] {
	return candidates.flatMap((candidate) =>
		candidate.slotId ? [{ slotId: candidate.slotId, kind: candidate.asset.kind }] : [],
	);
}

function assetKindForMimeType(mimeType: string): AssetKind | null {
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("video/")) return "video";
	if (mimeType.startsWith("audio/")) return "audio";
	return null;
}

function extensionForMimeType(mimeType: string): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	if (mimeType === "video/webm") return "webm";
	if (mimeType.startsWith("video/")) return "mp4";
	if (mimeType === "audio/wav") return "wav";
	if (mimeType === "audio/ogg") return "ogg";
	if (mimeType.startsWith("audio/")) return "mp3";
	return "png";
}
