import type {
	ContentGenerationMode,
	ContentGenerationOutputKind,
	ContentModelDescriptor,
	ContentReferenceKind,
} from "./types";

export interface ContentReferenceShape {
	slotId: string;
	kind: ContentReferenceKind;
}

export interface ContentModeResolution {
	mode: ContentGenerationMode | null;
	reason: "unsupported-kind" | "missing-required-input" | "too-many-inputs" | null;
}

export interface ContentReferenceAssignment extends ContentModeResolution {
	references: readonly ContentReferenceShape[];
	assignedSlotIds: readonly string[];
}

export function outputKindForNodeKind(kind: string): ContentGenerationOutputKind | null {
	if (kind === "image-generator") return "image";
	if (kind === "video-generator") return "video";
	return null;
}

export function isImageGenerationMode(modeId: string): boolean {
	return modeId === "text-to-image" || modeId === "image-to-image";
}

export function isRoleScopedContentGenerationMode(modeId: string | undefined): boolean {
	return modeId === "image-to-video" || modeId === "video-to-video" || modeId === "reference-to-video";
}

export function isContentReferenceSlotCompatible(
	model: ContentModelDescriptor,
	reference: ContentReferenceShape,
): boolean {
	return model.modes.some((mode) => acceptsReference(mode, reference));
}

export function isContentReferenceSlotCompatibleWithMode(
	model: ContentModelDescriptor,
	modeId: string | undefined,
	reference: ContentReferenceShape,
): boolean {
	const mode = model.modes.find((candidate) => candidate.id === modeId);
	return mode ? acceptsReference(mode, reference) : isContentReferenceSlotCompatible(model, reference);
}

export function isContentReferenceSlotDeclared(model: ContentModelDescriptor, slotId: string): boolean {
	return model.modes.some((mode) => mode.inputs.some((slot) => slot.id === slotId));
}

export function resolveContentGenerationMode(
	model: ContentModelDescriptor,
	references: readonly ContentReferenceShape[],
	preferredModeId?: string,
	strictPreferredMode = false,
): ContentModeResolution {
	const preferredModes = preferredModeId ? model.modes.filter((mode) => mode.id === preferredModeId) : [];
	const orderedModes = strictPreferredMode && preferredModes.length > 0
		? preferredModes
		: preferredModeId
		? [
				...preferredModes,
				...model.modes.filter((mode) => mode.id !== preferredModeId),
			]
		: model.modes;
	for (const mode of orderedModes) {
		if (matchesMode(mode, references, false)) return { mode, reason: null };
	}
	if (model.modes.every((mode) => references.some((reference) => !acceptsReference(mode, reference)))) {
		return { mode: null, reason: "unsupported-kind" };
	}
	if (model.modes.some((mode) => matchesMode(mode, references, true))) {
		return { mode: null, reason: "missing-required-input" };
	}
	return { mode: null, reason: "too-many-inputs" };
}

export function listAcceptedReferenceKinds(
	model: ContentModelDescriptor,
	references: readonly ContentReferenceShape[],
	preferredModeId?: string,
): ContentReferenceKind[] {
	const kinds: ContentReferenceKind[] = ["image", "video", "audio"];
	const preferredModes = preferredModeId ? model.modes.filter((mode) => mode.id === preferredModeId) : [];
	const modes = preferredModes.length > 0 ? preferredModes : model.modes;
	return kinds.filter((kind) =>
		modes.some((mode) =>
			mode.inputs.some((slot) =>
				slot.accepts.includes(kind) &&
				matchesMode(mode, [...references, { slotId: slot.id, kind }], true),
			),
		),
	);
}

export function slotIdForReferenceKind(
	model: ContentModelDescriptor,
	references: readonly ContentReferenceShape[],
	kind: ContentReferenceKind,
	preferredModeId?: string,
): string | null {
	const preferredModes = preferredModeId ? model.modes.filter((mode) => mode.id === preferredModeId) : [];
	const modes = preferredModes.length > 0 ? preferredModes : model.modes;
	for (const mode of modes) {
		for (const slot of mode.inputs) {
			if (!slot.accepts.includes(kind)) continue;
			if (matchesMode(mode, [...references, { slotId: slot.id, kind }], true)) return slot.id;
		}
	}
	return null;
}

export function assignContentReferenceSlots(
	model: ContentModelDescriptor,
	fixedReferences: readonly ContentReferenceShape[],
	unassignedKinds: readonly ContentReferenceKind[],
	preferredModeId?: string,
	strictPreferredMode = false,
): ContentReferenceAssignment {
	const preferredModes = preferredModeId ? model.modes.filter((mode) => mode.id === preferredModeId) : [];
	const orderedModes = strictPreferredMode && preferredModes.length > 0
		? preferredModes
		: preferredModeId
		? [
				...preferredModes,
				...model.modes.filter((mode) => mode.id !== preferredModeId),
			]
		: model.modes;
	let missingRequired: ContentReferenceAssignment | null = null;
	for (const mode of orderedModes) {
		const assigned = assignReferencesForMode(mode, fixedReferences, unassignedKinds);
		if (!assigned) continue;
		if (matchesMode(mode, assigned.references, false)) {
			return { ...assigned, mode, reason: null };
		}
		missingRequired ??= { ...assigned, mode: null, reason: "missing-required-input" };
	}
	if (missingRequired) return missingRequired;
	const unsupportedKind = [...fixedReferences.map(({ kind }) => kind), ...unassignedKinds].some(
		(kind) => !model.modes.some((mode) => mode.inputs.some((slot) => slot.accepts.includes(kind))),
	);
	return {
		mode: null,
		reason: unsupportedKind ? "unsupported-kind" : "too-many-inputs",
		references: fixedReferences,
		assignedSlotIds: [],
	};
}

function assignReferencesForMode(
	mode: ContentGenerationMode,
	fixedReferences: readonly ContentReferenceShape[],
	unassignedKinds: readonly ContentReferenceKind[],
): Pick<ContentReferenceAssignment, "references" | "assignedSlotIds"> | null {
	if (fixedReferences.some((reference) => !acceptsReference(mode, reference))) return null;
	const references = [...fixedReferences];
	const assignedSlotIds: string[] = [];
	for (const kind of unassignedKinds) {
		const slot = mode.inputs.find(
			(candidate) =>
				candidate.accepts.includes(kind) &&
				references.filter((reference) => reference.slotId === candidate.id).length < candidate.maxItems,
		);
		if (!slot) return null;
		references.push({ slotId: slot.id, kind });
		assignedSlotIds.push(slot.id);
	}
	if (mode.inputs.some((slot) => references.filter((reference) => reference.slotId === slot.id).length > slot.maxItems)) {
		return null;
	}
	return { references, assignedSlotIds };
}

function matchesMode(
	mode: ContentGenerationMode,
	references: readonly ContentReferenceShape[],
	allowMissingMinimums: boolean,
): boolean {
	if (references.some((reference) => !acceptsReference(mode, reference))) return false;
	const slotCountsMatch = mode.inputs.every((slot) => {
		const count = references.filter((reference) => reference.slotId === slot.id).length;
		return count <= slot.maxItems && (allowMissingMinimums || count >= slot.minItems);
	});
	if (!slotCountsMatch) return false;
	if (mode.maxTotalItems !== undefined && references.length > mode.maxTotalItems) return false;
	return allowMissingMinimums || mode.minTotalItems === undefined || references.length >= mode.minTotalItems;
}

function acceptsReference(mode: ContentGenerationMode, reference: ContentReferenceShape): boolean {
	const slot = mode.inputs.find((candidate) => candidate.id === reference.slotId);
	return Boolean(slot?.accepts.includes(reference.kind));
}
