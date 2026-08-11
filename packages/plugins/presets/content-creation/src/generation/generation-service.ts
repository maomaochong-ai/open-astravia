import { PluginMediaError } from "@vetta-org/plugin-sdk";
import type {
	AssetKind,
	ContentAsset,
	ContentNode,
	ContentNodeInputBinding,
	ContentProjectDocument,
	GenerationJob,
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
import { joinContentPath } from "../shared/path";
import {
	assignContentReferenceSlots,
	isContentReferenceSlotCompatibleWithMode,
	isContentReferenceSlotDeclared,
	isStrictContentGenerationMode,
	listAcceptedReferenceKinds,
	outputKindForNodeKind,
	shouldResolveStrictContentGenerationMode,
	slotIdForReferenceKind,
	type ContentReferenceShape,
} from "./model-inputs";
import { resolveContentAspectRatio } from "./aspect-ratio";
import { inferImageDimensionsFromBase64 } from "./image-dimensions";
import type { ContentProviderRegistry } from "./provider-registry";
import type {
	ContentArtifactStore,
	ContentGenerationOutputKind,
	ContentGenerationReference,
	ContentModelDescriptor,
	ContentProviderGenerationContext,
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
	origin: "binding" | "edge" | "prompt";
}

export class ContentGenerationService {
	private readonly abortController = new AbortController();
	private readonly activeJobIds = new Set<string>();

	constructor(
		private readonly workspace: ContentCreationWorkspace,
		private readonly providers: ContentProviderRegistry,
		private readonly artifacts: ContentArtifactStore,
	) {}

	dispose(): void {
		this.abortController.abort(new DOMException("Content generation runtime was disposed", "AbortError"));
	}

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
					...(file.width === undefined ? {} : { width: file.width }),
					...(file.height === undefined ? {} : { height: file.height }),
					createdAt: new Date().toISOString(),
				},
			});
		}

		for (const item of pending) {
			const stored = await this.artifacts.putImported(item.asset.id, item.file);
			item.asset.blobId = stored.blobId;
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
		preferredSlotId?: string,
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
		const model = findSelectedModel(this.listModels(outputKind), node, existingCandidates);
		if (!model) throw new Error("no compatible content model is configured");

		const currentAssignment = assignReferenceCandidates(model, existingCandidates, node.data.modeId).assignment;
		const nextShapes = [...currentAssignment.references];
		const pending: Array<{
			asset: ContentAsset;
			binding: ContentNodeInputBinding;
			file: ImportedContentReference;
		}> = [];
		for (const file of files) {
			const kind = assetKindForMimeType(file.mimeType);
			const preferredSlot = preferredSlotId
				? model.modes
						.find((mode) => mode.id === node.data.modeId)
						?.inputs.find((slot) => slot.id === preferredSlotId && kind && slot.accepts.includes(kind))
				: undefined;
			if (
				!kind ||
				(preferredSlotId
					? !preferredSlot
					: !listAcceptedReferenceKinds(model, nextShapes, node.data.modeId).includes(kind))
			) {
				throw new Error(`content model does not accept ${file.mimeType}: ${model.providerId}/${model.modelId}`);
			}
			const preferredCount = preferredSlot
				? nextShapes.filter((shape) => shape.slotId === preferredSlot.id).length
				: 0;
			const slotId = preferredSlotId
				? preferredSlot && preferredCount < preferredSlot.maxItems
					? preferredSlot.id
					: null
				: slotIdForReferenceKind(model, nextShapes, kind, node.data.modeId);
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
					...(file.width === undefined ? {} : { width: file.width }),
					...(file.height === undefined ? {} : { height: file.height }),
					createdAt: new Date().toISOString(),
				},
			});
			nextShapes.push({ slotId, kind });
		}

		for (const item of pending) {
			const stored = await this.artifacts.putImported(item.asset.id, item.file);
			item.asset.blobId = stored.blobId;
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
					...(file.width === undefined ? {} : { width: file.width }),
					...(file.height === undefined ? {} : { height: file.height }),
					createdAt: new Date().toISOString(),
				},
			});
		}
		for (const item of pending) {
			const stored = await this.artifacts.putImported(item.asset.id, item.file);
			item.asset.blobId = stored.blobId;
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
		if (!cwd) throw new Error("content generation requires a workspace output directory");
		const project = await this.workspace.load(cwd);
		const node = requireNode(project, nodeId);
		const outputKind = requireOutputKind(node);
		if (node.status === "running" || node.status === "queued") throw new Error(`node is already running: ${nodeId}`);
		const promptSources = listConnectedPromptSources(project, node.id);
		const selectedPrompts = resolveConnectedPromptSources(promptSources, node.data);
		const prompt = resolveContentPrompt(promptSources, node.data);
		if (!prompt) throw new Error("content generation requires a prompt");
		const candidates = listGenerationReferenceCandidates(project, node, selectedPrompts);
		const model = findSelectedModel(this.listModels(outputKind), node, candidates);
		if (!model) throw new Error("no compatible content model is configured");
		const prepared = assignReferenceCandidates(model, candidates, node.data.modeId);
		const assignment = prepared.assignment;
		const mode = assignment.mode;
		if (!mode) throw new Error(`content model inputs are incompatible: ${model.providerId}/${model.modelId}`);
		const jobId = crypto.randomUUID();
		const assetId = crypto.randomUUID();

		await this.workspace.dispatch(cwd, [
			{
				type: "node.update",
				nodeId,
				data: { providerId: model.providerId, modelId: model.modelId, modeId: mode.id },
			},
			{
				type: "job.start",
				job: { id: jobId, nodeId, providerId: model.providerId, modelId: model.modelId, outputAssetId: assetId },
			},
		]);
		this.activeJobIds.add(jobId);
		try {
			const references = await this.resolveReferences(cwd, prepared.candidates, assignment.assignedSlotIds);
			const explicitAspectRatio = mode.aspectRatioPolicy === "input-derived" ? undefined : node.data.aspectRatio;
			const aspectRatioReferences = await this.resolveAspectRatioReferences(
				outputKind,
				explicitAspectRatio,
				prepared.candidates,
				references,
			);
			const generated = await this.providers.generate(
				{
					modeId: mode.id,
					providerId: model.providerId,
					modelId: model.modelId,
					prompt,
					aspectRatio: resolveContentAspectRatio({
						outputKind,
						explicitAspectRatio,
						supportedAspectRatios: model.aspectRatios,
						references: aspectRatioReferences,
					}),
					quality: node.data.quality,
					duration: node.data.duration,
					resolution: node.data.resolution,
					references,
				},
				this.createProviderContext(cwd, jobId),
			);
			return await this.completeJob(cwd, jobId, generated);
		} catch (error) {
			if (this.abortController.signal.aborted) throw error;
			const message = error instanceof Error ? error.message : String(error);
			const errorCode = error instanceof PluginMediaError ? error.code : undefined;
			await this.workspace.dispatch(cwd, [
				{ type: "job.fail", jobId, error: message, ...(errorCode ? { errorCode } : {}) },
			]);
			throw error;
		} finally {
			this.activeJobIds.delete(jobId);
		}
	}

	async recoverActiveJobs(cwd: string | null): Promise<void> {
		if (!cwd || this.abortController.signal.aborted) return;
		const project = await this.workspace.load(cwd);
		const activeJobs = project.jobs.filter((job) => job.status === "queued" || job.status === "running");
		await Promise.all(activeJobs.map((job) => this.recoverJob(cwd, job)));
	}

	private async recoverJob(cwd: string, job: GenerationJob): Promise<void> {
		if (this.activeJobIds.has(job.id)) return;
		this.activeJobIds.add(job.id);
		try {
			if (!job.execution) {
				await this.failInterruptedJob(cwd, job.id, "generation job has no resumable host execution");
				return;
			}
			const generated = await this.providers.resume(
				job.provider,
				job.execution,
				this.createProviderContext(cwd, job.id),
			);
			await this.completeJob(cwd, job.id, generated);
		} catch (error) {
			if (this.abortController.signal.aborted) return;
			const message = error instanceof Error ? error.message : String(error);
			const errorCode = error instanceof PluginMediaError ? error.code : "provider-failed";
			await this.workspace.dispatch(cwd, [{ type: "job.fail", jobId: job.id, error: message, errorCode }]);
		} finally {
			this.activeJobIds.delete(job.id);
		}
	}

	private createProviderContext(cwd: string, jobId: string): ContentProviderGenerationContext {
		return {
			signal: this.abortController.signal,
			readReference: async (reference) => {
				const stored = await this.artifacts.readReference(reference);
				if (!stored) throw new Error(`content reference data not found: ${reference.id}`);
				return stored;
			},
			onExecution: async (execution) => {
				await this.workspace.dispatch(cwd, [
					{ type: "job.attach", jobId, execution, status: "queued", progress: 0 },
				]);
			},
			onProgress: async ({ status, progress }) => {
				await this.workspace.dispatch(cwd, [{ type: "job.update", jobId, status, progress }]);
			},
		};
	}

	private async completeJob(
		cwd: string,
		jobId: string,
		generated: Awaited<ReturnType<ContentProviderRegistry["generate"]>>,
	): Promise<ContentProjectDocument> {
		const project = await this.workspace.load(cwd);
		const job = project.jobs.find((candidate) => candidate.id === jobId);
		if (!job) throw new Error(`content generation job not found: ${jobId}`);
		const node = requireNode(project, job.nodeId);
		const assetId = job.outputAssetId ?? crypto.randomUUID();
		const fileName = generatedFileName(node.name, generated.kind, assetId, generated.mimeType);
		const stored = await this.artifacts.putGenerated(cwd, fileName, generated);
		const completed = await this.workspace.dispatch(cwd, [
			{
				type: "job.succeed",
				jobId,
				asset: {
					id: assetId,
					filePath: stored.filePath,
					kind: generated.kind,
					name: fileName,
					mimeType: stored.mimeType,
					duration: generated.duration,
					width: generated.width,
					height: generated.height,
					createdAt: new Date().toISOString(),
				},
			},
		]);
		await this.artifacts.releaseGenerated(generated);
		return completed;
	}

	private async failInterruptedJob(cwd: string, jobId: string, error: string): Promise<void> {
		await this.workspace.dispatch(cwd, [{ type: "job.fail", jobId, error, errorCode: "provider-failed" }]);
	}

	private async resolveReferences(
		cwd: string,
		candidates: readonly ReferenceCandidate[],
		assignedSlotIds: readonly string[],
	): Promise<ContentGenerationReference[]> {
		let unassignedIndex = 0;
		return await Promise.all(
			candidates.map(async (candidate) => {
				const slotId = candidate.slotId ?? assignedSlotIds[unassignedIndex++];
				if (!slotId) throw new Error(`content reference slot not resolved: ${candidate.asset.id}`);
				const asset = candidate.asset;
				const source = asset.filePath
					? { type: "workspace-file" as const, path: joinContentPath(cwd, asset.filePath) }
					: asset.blobId
						? { type: "plugin-blob" as const, blobId: asset.blobId }
						: null;
				if (!source) throw new Error(`content reference location not found: ${asset.id}`);
				return { id: candidate.id, slotId, kind: asset.kind, mimeType: asset.mimeType, source };
			}),
		);
	}

	private async resolveAspectRatioReferences(
		outputKind: ContentGenerationOutputKind,
		explicitAspectRatio: string | undefined,
		candidates: readonly ReferenceCandidate[],
		references: readonly ContentGenerationReference[],
	) {
		const assets = candidates.map(({ asset }) => asset);
		if (outputKind !== "video" || explicitAspectRatio) return assets;
		const firstImageIndex = candidates.findIndex(({ asset }) => asset.kind === "image");
		if (firstImageIndex < 0) return assets;
		const image = assets[firstImageIndex];
		if (!image || (isPositiveDimension(image.width) && isPositiveDimension(image.height))) return assets;
		const reference = references[firstImageIndex];
		if (!reference) return assets;
		const stored = await this.artifacts.readReference(reference).catch(() => null);
		if (!stored) return assets;
		const dimensions = await inferImageDimensionsFromBase64(stored.data, stored.mimeType);
		if (!dimensions) return assets;
		return assets.map((asset, index) => (index === firstImageIndex ? { ...asset, ...dimensions } : asset));
	}
}

function isPositiveDimension(value: number | undefined): value is number {
	return Number.isFinite(value) && (value ?? 0) > 0;
}

function requireOutputKind(node: ContentNode): ContentGenerationOutputKind {
	const outputKind = outputKindForNodeKind(node.kind);
	if (!outputKind) throw new Error(`node is not executable: ${node.kind}`);
	return outputKind;
}

function findSelectedModel(
	models: readonly ContentModelDescriptor[],
	node: ContentNode,
	references: readonly ReferenceCandidate[],
): ContentModelDescriptor | undefined {
	const selected = models.find(
		(model) => model.providerId === node.data.providerId && model.modelId === node.data.modelId,
	);
	if (selected) return selected;
	return models.find(
		(model) => assignReferenceCandidates(model, references, node.data.modeId).assignment.mode !== null,
	);
}

function assignReferenceCandidates(
	model: ContentModelDescriptor,
	candidates: readonly ReferenceCandidate[],
	preferredModeId?: string,
) {
	const strictPreferredMode = shouldResolveStrictContentGenerationMode(
		model,
		preferredModeId,
		candidates.flatMap((candidate) =>
			candidate.origin === "binding" && candidate.slotId
				? [{ slotId: candidate.slotId, kind: candidate.asset.kind }]
				: [],
		),
	);
	const preferredMode = strictPreferredMode ? model.modes.find((mode) => mode.id === preferredModeId) : undefined;
	const normalizedCandidates = candidates.flatMap((candidate) => {
		if (
			!candidate.slotId ||
			isContentReferenceSlotCompatibleWithMode(model, preferredModeId, {
				slotId: candidate.slotId,
				kind: candidate.asset.kind,
			})
		) {
			return [candidate];
		}
		if (preferredMode && candidate.origin === "binding" && isContentReferenceSlotDeclared(model, candidate.slotId)) {
			return [];
		}
		return [{ ...candidate, slotId: undefined }];
	});
	const assignment = assignCandidates(model, normalizedCandidates, preferredModeId, strictPreferredMode);
	const result = {
		candidates: normalizedCandidates,
		assignment,
	};
	if (assignment.mode || assignment.reason !== "too-many-inputs") return result;

	const explicitKinds = new Set(
		normalizedCandidates
			.filter((candidate) => candidate.origin !== "edge")
			.map(({ asset }) => asset.kind),
	);
	const prioritizedCandidates = normalizedCandidates.filter(
		(candidate) => candidate.origin !== "edge" || !explicitKinds.has(candidate.asset.kind),
	);
	if (prioritizedCandidates.length === normalizedCandidates.length) return result;
	const prioritizedAssignment = assignCandidates(model, prioritizedCandidates, preferredModeId, strictPreferredMode);
	return prioritizedAssignment.mode
		? { candidates: prioritizedCandidates, assignment: prioritizedAssignment }
		: result;
}

function assignCandidates(
	model: ContentModelDescriptor,
	candidates: readonly ReferenceCandidate[],
	preferredModeId?: string,
	strictPreferredMode = isStrictContentGenerationMode(preferredModeId),
) {
	const fixedReferences = referenceShapes(candidates.filter((candidate) => candidate.slotId));
	const unassignedKinds = candidates.filter((candidate) => !candidate.slotId).map(({ asset }) => asset.kind);
	return assignContentReferenceSlots(
		model,
		fixedReferences,
		unassignedKinds,
		preferredModeId,
		strictPreferredMode && model.modes.some((mode) => mode.id === preferredModeId),
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
		return asset ? [{ id: binding.id, asset, slotId: binding.slotId, origin: "binding" }] : [];
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
			origin: "edge",
		});
	}
	for (const promptSource of promptSources) {
		for (const { binding, asset } of promptSource.references) {
			candidates.push({ id: `prompt:${promptSource.nodeId}:${binding.id}`, asset, origin: "prompt" });
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

function generatedFileName(label: string | undefined, kind: "image" | "video", assetId: string, mimeType: string): string {
	const requestedStem = label?.trim() || kind;
	const stem = requestedStem
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
		.replace(/[. ]+$/g, "")
		.slice(0, 80) || kind;
	return `${stem}-${assetId}.${extensionForMimeType(mimeType)}`;
}
