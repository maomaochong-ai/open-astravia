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

export function outputKindForNodeKind(kind: string): ContentGenerationOutputKind | null {
	if (kind === "image-generator") return "image";
	if (kind === "video-generator") return "video";
	return null;
}

export function isImageGenerationMode(modeId: string): boolean {
	return modeId === "text-to-image" || modeId === "image-to-image";
}

export function resolveContentGenerationMode(
	model: ContentModelDescriptor,
	references: readonly ContentReferenceShape[],
	preferredModeId?: string,
): ContentModeResolution {
	const orderedModes = preferredModeId
		? [
				...model.modes.filter((mode) => mode.id === preferredModeId),
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
): ContentReferenceKind[] {
	const kinds: ContentReferenceKind[] = ["image", "video"];
	return kinds.filter((kind) =>
		model.modes.some((mode) =>
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
): string | null {
	for (const mode of model.modes) {
		for (const slot of mode.inputs) {
			if (!slot.accepts.includes(kind)) continue;
			if (matchesMode(mode, [...references, { slotId: slot.id, kind }], true)) return slot.id;
		}
	}
	return null;
}

function matchesMode(
	mode: ContentGenerationMode,
	references: readonly ContentReferenceShape[],
	allowMissingMinimums: boolean,
): boolean {
	if (references.some((reference) => !acceptsReference(mode, reference))) return false;
	return mode.inputs.every((slot) => {
		const count = references.filter((reference) => reference.slotId === slot.id).length;
		return count <= slot.maxItems && (allowMissingMinimums || count >= slot.minItems);
	});
}

function acceptsReference(mode: ContentGenerationMode, reference: ContentReferenceShape): boolean {
	const slot = mode.inputs.find((candidate) => candidate.id === reference.slotId);
	return Boolean(slot?.accepts.includes(reference.kind));
}
