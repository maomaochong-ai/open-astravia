export const REMOTION_DOCUMENT_MIME_TYPE = "application/vnd.vetta.remotion-project+json";

export interface RemotionRenderDocument {
	schemaVersion: 1;
	projectRoot: string;
	entryPoint: string;
	compositionId: string;
	inputProps: Record<string, unknown>;
	outputPath: string;
	codec: "h264";
}

export function createRemotionRenderDocument(
	input: Omit<RemotionRenderDocument, "schemaVersion" | "codec">,
): RemotionRenderDocument {
	return {
		schemaVersion: 1,
		codec: "h264",
		...input,
	};
}

