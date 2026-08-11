import type {
	AssetKind,
	ContentNode,
	ContentProjectDocument,
} from "../project/types";
import { outputKindForNodeKind, resolveContentGenerationMode } from "./model-inputs";
import type {
	ContentGenerationMode,
	ContentModelDescriptor,
	ContentReferenceKind,
} from "./types";

export const CONTENT_VIDEO_GENERATION_INTENTS = [
	"text-to-video",
	"animate-still",
	"interpolate-frames",
	"reference-guided",
	"transform-video",
] as const;

export type ContentVideoGenerationIntent = (typeof CONTENT_VIDEO_GENERATION_INTENTS)[number];

export const CONTENT_GENERATION_SOURCE_ROLES = [
	"firstFrame",
	"lastFrame",
	"referenceImages",
	"referenceVideos",
	"referenceAudios",
] as const;

export type ContentGenerationSourceRole = (typeof CONTENT_GENERATION_SOURCE_ROLES)[number];

export interface ContentGenerationSourceSpec {
	sourceNodeId: string;
	assetIds?: readonly string[];
	role?: ContentGenerationSourceRole;
}

export interface ContentGenerationBindingPlan {
	sourceNodeId: string;
	assetIds: string[];
	kind: ContentReferenceKind;
	slotId: string;
	targetHandle: "image" | "video" | "audio";
}

export interface ContentVideoGenerationPlan {
	intent: ContentVideoGenerationIntent;
	providerId: string;
	modelId: string;
	modeId: ContentGenerationMode["id"];
	bindings: ContentGenerationBindingPlan[];
}

export interface ContentVideoGenerationPlanOptions {
	providerId?: string;
	modelId?: string;
}

export type ContentGenerationConfigurationFailure =
	| "model-unavailable"
	| "source-asset-missing"
	| "source-role-missing"
	| "inputs-incompatible";

export type ContentGenerationConfigurationResolution =
	| { ok: true; model: ContentModelDescriptor; mode: ContentGenerationMode }
	| { ok: false; reason: ContentGenerationConfigurationFailure };

export class ContentGenerationIntentError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
	}
}

interface ResolvedSource {
	sourceNodeId: string;
	assetIds: string[];
	kind: ContentReferenceKind;
	requestedRole?: ContentGenerationSourceRole;
}

interface RoleSource extends ResolvedSource {
	role: ContentGenerationSourceRole;
}

export function planContentVideoGeneration(
	project: ContentProjectDocument,
	targetNodeId: string,
	intent: ContentVideoGenerationIntent,
	sources: readonly ContentGenerationSourceSpec[],
	models: readonly ContentModelDescriptor[],
	options: ContentVideoGenerationPlanOptions = {},
): ContentVideoGenerationPlan {
	const target = requireNode(project, targetNodeId);
	if (target.kind !== "video-generator") {
		throw new ContentGenerationIntentError(
			"generation intent target must be a video generator",
			"generation-intent-target-invalid",
			{ targetNodeId, targetKind: target.kind },
		);
	}
	const resolvedSources = sources.flatMap((source) => resolveSource(project, source));
	const roleSources = assignBusinessRoles(intent, resolvedSources);
	const candidates = models.filter(
		(model) =>
			model.outputKind === "video" &&
			(!options.providerId || model.providerId === options.providerId) &&
			(!options.modelId || model.modelId === options.modelId),
	);
	for (const model of candidates) {
		for (const mode of orderedModes(model, intent)) {
			const bindings = compileBindings(mode, intent, roleSources);
			if (!bindings) continue;
			const resolution = resolveContentGenerationMode(
				model,
				bindings.map(({ slotId, kind }) => ({ slotId, kind })),
				mode.id,
				true,
			);
			if (resolution.mode?.id !== mode.id) continue;
			return {
				intent,
				providerId: model.providerId,
				modelId: model.modelId,
				modeId: mode.id,
				bindings,
			};
		}
	}
	throw new ContentGenerationIntentError(
		options.providerId || options.modelId
			? "selected model cannot satisfy the requested video generation intent"
			: "no configured model can satisfy the requested video generation intent",
		options.providerId || options.modelId
			? "generation-intent-selected-model-incompatible"
			: "generation-intent-model-unavailable",
		{
			intent,
			targetNodeId,
			requestedProviderId: options.providerId,
			requestedModelId: options.modelId,
			availableModels: candidates.map((model) => `${model.providerId}/${model.modelId}`),
		},
	);
}

export function targetHandleForReferenceKind(
	kind: ContentReferenceKind,
): ContentGenerationBindingPlan["targetHandle"] {
	if (kind === "image") return "image";
	if (kind === "video") return "video";
	return "audio";
}

export function resolveConfiguredContentGeneration(
	project: ContentProjectDocument,
	node: ContentNode,
	models: readonly ContentModelDescriptor[],
): ContentGenerationConfigurationResolution {
	const outputKind = outputKindForNodeKind(node.kind);
	if (!outputKind) return { ok: false, reason: "model-unavailable" };
	const candidates = models.filter(
		(model) =>
			model.outputKind === outputKind &&
			(!node.data.providerId || model.providerId === node.data.providerId) &&
			(!node.data.modelId || model.modelId === node.data.modelId),
	);
	if (candidates.length === 0) return { ok: false, reason: "model-unavailable" };
	const referenceResolution = explicitGenerationReferenceShapes(project, node);
	if (!referenceResolution.ok) return referenceResolution;
	for (const model of candidates) {
		const resolution = resolveContentGenerationMode(
			model,
			referenceResolution.shapes,
			node.data.modeId,
			Boolean(node.data.modeId),
		);
		if (resolution.mode) return { ok: true, model, mode: resolution.mode };
	}
	return { ok: false, reason: "inputs-incompatible" };
}

function requireNode(project: ContentProjectDocument, nodeId: string): ContentNode {
	const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) {
		throw new ContentGenerationIntentError(`generation source node not found: ${nodeId}`, "generation-source-not-found", {
			nodeId,
		});
	}
	return node;
}

function explicitGenerationReferenceShapes(
	project: ContentProjectDocument,
	node: ContentNode,
):
	| { ok: true; shapes: Array<{ slotId: string; kind: ContentReferenceKind }> }
	| { ok: false; reason: "source-asset-missing" | "source-role-missing" } {
	const shapes: Array<{ slotId: string; kind: ContentReferenceKind }> = [];
	for (const binding of node.data.inputs ?? []) {
		if (binding.slotId === "promptReferences") continue;
		const asset = project.assets.find((candidate) => candidate.id === binding.assetId);
		if (!asset) return { ok: false, reason: "source-asset-missing" };
		shapes.push({ slotId: binding.slotId, kind: asset.kind });
	}
	for (const edge of project.graph.edges) {
		if (edge.target !== node.id || edge.targetHandle === "prompt") continue;
		const source = project.graph.nodes.find((candidate) => candidate.id === edge.source);
		if (!source || source.kind === "asset") continue;
		const kind = source.kind === "image-generator"
			? "image"
			: source.kind === "video-generator"
				? "video"
				: null;
		if (!kind) continue;
		const role = edge.role ?? (node.kind === "image-generator" && kind === "image" ? "referenceImages" : null);
		if (!role) return { ok: false, reason: "source-role-missing" };
		shapes.push({ slotId: role, kind });
	}
	return { ok: true, shapes };
}

function resolveSource(project: ContentProjectDocument, source: ContentGenerationSourceSpec): ResolvedSource[] {
	const node = requireNode(project, source.sourceNodeId);
	if (node.kind === "image-generator" || node.kind === "video-generator") {
		if (source.assetIds?.length) {
			throw new ContentGenerationIntentError(
				"generated node sources must bind their node output, not asset IDs",
				"generation-source-assets-unexpected",
				{ sourceNodeId: node.id },
			);
		}
		return [{
			sourceNodeId: node.id,
			assetIds: [],
			kind: node.kind === "image-generator" ? "image" : "video",
			requestedRole: source.role,
		}];
	}
	if (node.kind !== "asset") {
		throw new ContentGenerationIntentError(
			"generation sources must be asset, image-generator, or video-generator nodes",
			"generation-source-kind-invalid",
			{ sourceNodeId: node.id, sourceKind: node.kind },
		);
	}
	const assetIds = source.assetIds?.length ? [...new Set(source.assetIds)] : [];
	if (assetIds.length === 0) {
		throw new ContentGenerationIntentError(
			"asset node generation sources require explicit asset IDs",
			"generation-source-assets-required",
			{ sourceNodeId: node.id },
		);
	}
	const availableAssetIds = new Set(node.data.assetIds ?? []);
	return assetIds.map((assetId) => {
		if (!availableAssetIds.has(assetId)) {
			throw new ContentGenerationIntentError(
				`asset is not present in source node: ${assetId}`,
				"generation-source-asset-not-found",
				{ sourceNodeId: node.id, assetId },
			);
		}
		const asset = project.assets.find((candidate) => candidate.id === assetId);
		if (!asset) {
			throw new ContentGenerationIntentError(
				`generation source asset not found: ${assetId}`,
				"generation-source-asset-not-found",
				{ sourceNodeId: node.id, assetId },
			);
		}
		return {
			sourceNodeId: node.id,
			assetIds: [assetId],
			kind: asset.kind,
			requestedRole: source.role,
		};
	});
}

function assignBusinessRoles(
	intent: ContentVideoGenerationIntent,
	sources: readonly ResolvedSource[],
): RoleSource[] {
	if (intent === "text-to-video") {
		if (sources.length > 0) return invalidSources(intent, "text-to-video does not accept media sources");
		return [];
	}
	if (intent === "animate-still") {
		if (sources.length !== 1 || sources[0]?.kind !== "image") {
			return invalidSources(intent, "animate-still requires exactly one image source");
		}
		if (sources[0].requestedRole && sources[0].requestedRole !== "firstFrame") {
			return invalidSources(intent, "animate-still only accepts the firstFrame role");
		}
		return [{ ...sources[0], role: "firstFrame" }];
	}
	if (intent === "interpolate-frames") {
		if (sources.length !== 2 || sources.some((source) => source.kind !== "image")) {
			return invalidSources(intent, "interpolate-frames requires exactly two image sources");
		}
		const explicitFirst = sources.filter((source) => source.requestedRole === "firstFrame");
		const explicitLast = sources.filter((source) => source.requestedRole === "lastFrame");
		if (explicitFirst.length > 1 || explicitLast.length > 1) {
			return invalidSources(intent, "interpolate-frames requires unique firstFrame and lastFrame roles");
		}
		const first = explicitFirst[0] ?? sources.find((source) => source.requestedRole !== "lastFrame");
		const last = explicitLast[0] ?? sources.find((source) => source !== first && source.requestedRole !== "firstFrame");
		if (!first || !last || first === last) {
			return invalidSources(intent, "interpolate-frames requires distinct first and last frame sources");
		}
		if (
			sources.some(
				(source) => source.requestedRole && source.requestedRole !== "firstFrame" && source.requestedRole !== "lastFrame",
			)
		) {
			return invalidSources(intent, "interpolate-frames only accepts firstFrame and lastFrame roles");
		}
		return [{ ...first, role: "firstFrame" }, { ...last, role: "lastFrame" }];
	}
	if (intent === "transform-video") {
		if (sources.length !== 1 || sources[0]?.kind !== "video") {
			return invalidSources(intent, "transform-video requires exactly one video source");
		}
		if (sources[0].requestedRole && sources[0].requestedRole !== "referenceVideos") {
			return invalidSources(intent, "transform-video only accepts the referenceVideos role");
		}
		return [{ ...sources[0], role: "referenceVideos" }];
	}
	if (sources.length === 0) {
		return invalidSources(intent, "reference-guided generation requires at least one media source");
	}
	return sources.map((source) => ({
		...source,
		role: source.requestedRole ?? defaultReferenceRole(source.kind),
	}));
}

function invalidSources(intent: ContentVideoGenerationIntent, message: string): never {
	throw new ContentGenerationIntentError(message, "generation-intent-sources-invalid", { intent });
}

function defaultReferenceRole(kind: AssetKind): ContentGenerationSourceRole {
	if (kind === "image") return "referenceImages";
	if (kind === "video") return "referenceVideos";
	return "referenceAudios";
}

function orderedModes(model: ContentModelDescriptor, intent: ContentVideoGenerationIntent): ContentGenerationMode[] {
	const modeIds = intent === "text-to-video"
		? ["text-to-video"]
		: intent === "animate-still" || intent === "interpolate-frames"
			? ["image-to-video"]
			: intent === "transform-video"
				? ["video-to-video", "reference-to-video"]
				: ["reference-to-video", "video-to-video"];
	return modeIds.flatMap((modeId) => model.modes.filter((mode) => mode.id === modeId));
}

function compileBindings(
	mode: ContentGenerationMode,
	intent: ContentVideoGenerationIntent,
	sources: readonly RoleSource[],
): ContentGenerationBindingPlan[] | null {
	const counts = new Map<string, number>();
	const bindings: ContentGenerationBindingPlan[] = [];
	for (const source of sources) {
		const slot = resolveRoleSlot(mode, intent, source.role, source.kind);
		if (!slot) return null;
		const nextCount = (counts.get(slot.id) ?? 0) + 1;
		if (nextCount > slot.maxItems) return null;
		counts.set(slot.id, nextCount);
		const existing = bindings.find(
			(binding) =>
				binding.sourceNodeId === source.sourceNodeId &&
				binding.kind === source.kind &&
				binding.slotId === slot.id,
		);
		if (existing) {
			existing.assetIds.push(...source.assetIds.filter((assetId) => !existing.assetIds.includes(assetId)));
			continue;
		}
		bindings.push({
			sourceNodeId: source.sourceNodeId,
			assetIds: [...source.assetIds],
			kind: source.kind,
			slotId: slot.id,
			targetHandle: targetHandleForReferenceKind(source.kind),
		});
	}
	return bindings;
}

function resolveRoleSlot(
	mode: ContentGenerationMode,
	intent: ContentVideoGenerationIntent,
	role: ContentGenerationSourceRole,
	kind: ContentReferenceKind,
): ContentGenerationMode["inputs"][number] | null {
	const exact = mode.inputs.find((slot) => slot.id === role && slot.accepts.includes(kind));
	if (exact) return exact;
	if (role === "lastFrame") return null;
	if (role === "firstFrame" && intent === "animate-still" && mode.id === "image-to-video") {
		return mode.inputs.find((slot) => slot.accepts.includes("image")) ?? null;
	}
	const aliases = role === "referenceVideos"
		? ["referenceVideos", "referenceVideo"]
		: role === "referenceAudios"
			? ["referenceAudios", "referenceAudio"]
			: [role];
	return mode.inputs.find((slot) => aliases.includes(slot.id) && slot.accepts.includes(kind)) ?? null;
}
