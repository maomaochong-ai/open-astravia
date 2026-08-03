import type {
	ContentAsset,
	ContentNode,
	ContentNodeInputBinding,
	ContentProjectDocument,
} from "../project/types";
import type { ContentCreationWorkspace } from "../project/workspace";
import {
	listAcceptedReferenceKinds,
	outputKindForNodeKind,
	resolveContentGenerationMode,
	slotIdForReferenceKind,
	type ContentReferenceShape,
} from "./model-inputs";
import type { ContentProviderRegistry } from "./provider-registry";
import type {
	ContentArtifactStore,
	ContentGenerationOutputKind,
	ContentGenerationReference,
	ContentModelDescriptor,
	ContentReferenceKind,
	ImportedContentReference,
} from "./types";

function requireNode(project: ContentProjectDocument, nodeId: string): ContentNode {
	const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`content node not found: ${nodeId}`);
	return node;
}

function resolvePrompt(project: ContentProjectDocument, node: ContentNode): string {
	const direct = node.data.prompt?.trim();
	if (direct) return direct;
	const promptEdge = project.graph.edges.find((edge) => edge.target === node.id && edge.targetHandle === "prompt");
	const source = promptEdge ? project.graph.nodes.find((candidate) => candidate.id === promptEdge.source) : undefined;
	const connected = source?.data.prompt?.trim();
	if (!connected) throw new Error("content generation requires a prompt");
	return connected;
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

	async importReferences(
		cwd: string | null,
		nodeId: string,
		files: readonly ImportedContentReference[],
	): Promise<ContentProjectDocument> {
		if (files.length === 0) return await this.workspace.load(cwd);
		const project = await this.workspace.load(cwd);
		const node = requireNode(project, nodeId);
		const outputKind = requireOutputKind(node);
		const existingBindings = node.data.inputs ?? [];
		const existingShapes = resolveBindingShapes(project, existingBindings);
		const model = findSelectedModel(this.listModels(outputKind), node, existingShapes);
		if (!model) throw new Error("no compatible content model is configured");

		const nextShapes = [...existingShapes];
		const pending: Array<{
			asset: ContentAsset;
			binding: ContentNodeInputBinding;
			file: ImportedContentReference;
		}> = [];
		for (const file of files) {
			const kind = referenceKindForMimeType(file.mimeType);
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
					kind,
					name: file.name.trim() || `${kind}-${assetId.slice(0, 8)}.${extensionForMimeType(file.mimeType)}`,
					mimeType: file.mimeType,
					url: "",
					createdAt: new Date().toISOString(),
				},
			});
			nextShapes.push({ slotId, kind });
		}

		for (const item of pending) {
			const stored = await this.artifacts.put(item.asset.id, item.file);
			item.asset.url = stored.url;
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

	async runNode(cwd: string | null, nodeId: string): Promise<ContentProjectDocument> {
		const project = await this.workspace.load(cwd);
		const node = requireNode(project, nodeId);
		const outputKind = requireOutputKind(node);
		if (node.status === "running" || node.status === "queued") throw new Error(`node is already running: ${nodeId}`);
		const references = await this.resolveReferences(project, node);
		const referenceShapes = references.map(({ slotId, kind }) => ({ slotId, kind }));
		const model = findSelectedModel(this.listModels(outputKind), node, referenceShapes);
		if (!model) throw new Error("no compatible content model is configured");
		const mode = resolveContentGenerationMode(model, referenceShapes, node.data.modeId).mode;
		if (!mode) throw new Error(`content model inputs are incompatible: ${model.providerId}/${model.modelId}`);
		const prompt = resolvePrompt(project, node);
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
						kind: generated.kind,
						name: `${node.data.label?.trim() || `${generated.kind}-${assetId.slice(0, 8)}`}.${extensionForMimeType(generated.mimeType)}`,
						mimeType: stored.mimeType,
						url: stored.url,
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
		project: ContentProjectDocument,
		node: ContentNode,
	): Promise<ContentGenerationReference[]> {
		const bindings: ContentNodeInputBinding[] = [...(node.data.inputs ?? [])];
		for (const edge of project.graph.edges.filter((candidate) => candidate.target === node.id)) {
			if (edge.targetHandle === "prompt") continue;
			const source = project.graph.nodes.find((candidate) => candidate.id === edge.source);
			const asset = source?.data.assetId
				? project.assets.find((candidate) => candidate.id === source.data.assetId)
				: undefined;
			if (!asset || (asset.kind !== "image" && asset.kind !== "video")) continue;
			bindings.push({
				id: `edge:${edge.id}`,
				assetId: asset.id,
				slotId: asset.kind === "image" ? "referenceImages" : "referenceVideo",
			});
		}

		const uniqueBindings = bindings.filter(
			(binding, index) => bindings.findIndex((candidate) => candidate.assetId === binding.assetId) === index,
		);
		return await Promise.all(
			uniqueBindings.map(async (binding) => {
				const asset = project.assets.find((candidate) => candidate.id === binding.assetId);
				if (!asset || (asset.kind !== "image" && asset.kind !== "video")) {
					throw new Error(`content reference asset not found: ${binding.assetId}`);
				}
				const stored = await this.artifacts.read(asset.id);
				if (!stored) throw new Error(`content reference data not found: ${asset.id}`);
				return { id: binding.id, slotId: binding.slotId, kind: asset.kind, ...stored };
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
	references: readonly ContentReferenceShape[],
): ContentModelDescriptor | undefined {
	const selected = models.find(
		(model) => model.providerId === node.data.providerId && model.modelId === node.data.modelId,
	);
	if (selected) return selected;
	return models.find((model) => resolveContentGenerationMode(model, references).mode !== null);
}

function resolveBindingShapes(
	project: ContentProjectDocument,
	bindings: readonly ContentNodeInputBinding[],
): ContentReferenceShape[] {
	return bindings.flatMap((binding) => {
		const asset = project.assets.find((candidate) => candidate.id === binding.assetId);
		return asset?.kind === "image" || asset?.kind === "video" ? [{ slotId: binding.slotId, kind: asset.kind }] : [];
	});
}

function referenceKindForMimeType(mimeType: string): ContentReferenceKind | null {
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("video/")) return "video";
	return null;
}

function extensionForMimeType(mimeType: string): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	if (mimeType === "video/webm") return "webm";
	if (mimeType.startsWith("video/")) return "mp4";
	return "png";
}
