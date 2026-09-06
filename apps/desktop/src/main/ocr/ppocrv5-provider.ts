import type { OcrProviderRegistration } from "./ocr-provider-registry.js";
import { runImagesOcr } from "./pdf-ocr.js";

export const PP_OCRV5_DESCRIPTOR = {
	id: "desktop-app:ppocrv5",
	displayName: "PP-OCRv5",
	ownerId: "desktop-app",
	protocolVersion: 1 as const,
	processing: "local" as const,
	execution: "sync" as const,
	status: "ready" as const,
	input: {
		kinds: ["image" as const],
		mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/gif"],
		acceptsInlineBytes: false,
		acceptsUrl: true,
	},
	output: {
		granularities: ["text" as const, "line" as const],
		supportsConfidence: true,
		supportsPolygon: false,
		supportsLanguageDetection: false,
	},
} satisfies NonNullable<OcrProviderRegistration["descriptor"]>;

export function createPpOcrV5Provider(): OcrProviderRegistration {
	return {
		descriptor: PP_OCRV5_DESCRIPTOR,
		recognize: async (request, context) => {
			const paths = await Promise.all(request.inputs.map((input) => context.getInputPath(input.id)));
			if (context.signal.aborted) throw context.signal.reason ?? new DOMException("OCR cancelled", "AbortError");
			const result = await runImagesOcr({
				images: paths.map((imagePath) => ({ imagePath })),
				langs: [...(request.languages ?? ["ch", "en"])],
				debug: false,
				onProgress: ({ page, total, phase }) =>
					context.reportProgress({
						phase: phase === "done" ? "finalizing" : "processing",
						completed: phase === "done" ? total : Math.max(0, page - 1),
						total,
						itemId: request.inputs[page - 1]?.id,
					}),
			});
			const items = request.inputs.map((input, index) => {
				const page = result.pages[index];
				return {
					id: input.id,
					status: "ok" as const,
					text: page?.text ?? "",
					width: page?.width,
					height: page?.height,
					confidence: page?.confidence === undefined ? undefined : page.confidence / 100,
				};
			});
			context.reportProgress({
				phase: "finalizing",
				completed: request.inputs.length,
				total: request.inputs.length,
			});
			return { protocolVersion: 1, providerId: PP_OCRV5_DESCRIPTOR.id, model: "PP-OCRv5", items };
		},
	};
}
