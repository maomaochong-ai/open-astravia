import type { ContentGenerationOutputKind, ContentReferenceKind } from "./types";

export interface SizedContentReference {
	kind: ContentReferenceKind;
	width?: number;
	height?: number;
}

interface ResolveContentAspectRatioOptions {
	outputKind: ContentGenerationOutputKind;
	explicitAspectRatio?: string;
	supportedAspectRatios: readonly string[];
	references: readonly SizedContentReference[];
}

export function resolveContentAspectRatio({
	outputKind,
	explicitAspectRatio,
	supportedAspectRatios,
	references,
}: ResolveContentAspectRatioOptions): string | undefined {
	if (explicitAspectRatio && supportedAspectRatios.includes(explicitAspectRatio)) return explicitAspectRatio;
	if (outputKind === "video") {
		const image = references.find(
			(reference) =>
				reference.kind === "image" &&
				Number.isFinite(reference.width) &&
				Number.isFinite(reference.height) &&
				(reference.width ?? 0) > 0 &&
				(reference.height ?? 0) > 0,
		);
		if (image?.width && image.height) {
			const sourceRatio = image.width / image.height;
			const closest = supportedAspectRatios
				.map((value) => ({ value, ratio: parseAspectRatio(value) }))
				.filter((candidate): candidate is { value: string; ratio: number } => candidate.ratio !== null)
				.sort(
					(left, right) =>
						Math.abs(Math.log(left.ratio / sourceRatio)) - Math.abs(Math.log(right.ratio / sourceRatio)),
				)[0];
			if (closest) return closest.value;
		}
	}
	const preferred = outputKind === "video" ? "16:9" : "1:1";
	return supportedAspectRatios.includes(preferred) ? preferred : supportedAspectRatios[0];
}

function parseAspectRatio(value: string): number | null {
	const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? width / height : null;
}
