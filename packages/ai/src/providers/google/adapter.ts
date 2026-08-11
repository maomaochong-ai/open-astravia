import { createGoogleSdkAdapter, type GoogleGenerateContentSender } from "../google-stream/adapter.js";
import { createGoogleClient } from "./client.js";
import type { GoogleOptions } from "./options.js";
import { buildGoogleParams } from "./request.js";

export type GoogleContentSender = GoogleGenerateContentSender<"google-generative-ai", GoogleOptions>;

export interface GoogleAdapterDependencies {
	readonly send?: GoogleContentSender;
}

const sendGoogleContent: GoogleContentSender = async (params, request) => {
	return await createGoogleClient(request).models.generateContentStream(params);
};

export const googleAdapter = createGoogleAdapter();

export function createGoogleAdapter(dependencies: GoogleAdapterDependencies = {}) {
	return createGoogleSdkAdapter({
		api: "google-generative-ai",
		buildParams: buildGoogleParams,
		send: dependencies.send ?? sendGoogleContent,
	});
}
