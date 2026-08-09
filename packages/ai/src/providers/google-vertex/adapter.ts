import { createGoogleSdkAdapter, type GoogleGenerateContentSender } from "../google-stream/adapter.js";
import { createGoogleVertexClient } from "./client.js";
import type { GoogleVertexOptions } from "./options.js";
import { buildGoogleVertexParams } from "./request.js";

export type GoogleVertexContentSender = GoogleGenerateContentSender<"google-vertex", GoogleVertexOptions>;

export interface GoogleVertexAdapterDependencies {
	readonly send?: GoogleVertexContentSender;
}

const sendGoogleVertexContent: GoogleVertexContentSender = async (params, request) => {
	return await createGoogleVertexClient(request).models.generateContentStream(params);
};

export const googleVertexAdapter = createGoogleVertexAdapter();

export function createGoogleVertexAdapter(dependencies: GoogleVertexAdapterDependencies = {}) {
	return createGoogleSdkAdapter({
		api: "google-vertex",
		buildParams: buildGoogleVertexParams,
		send: dependencies.send ?? sendGoogleVertexContent,
	});
}
