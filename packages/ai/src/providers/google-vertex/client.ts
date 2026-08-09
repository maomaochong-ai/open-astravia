import { GoogleGenAI } from "@google/genai";
import type { ModelCallRequest } from "../../runtime/language-model-adapter.js";
import type { GoogleVertexOptions } from "./options.js";

const API_VERSION = "v1";

export function createGoogleVertexClient(request: ModelCallRequest<"google-vertex", GoogleVertexOptions>): GoogleGenAI {
	const { model, options } = request;
	const headers = model.headers || options?.headers ? { ...model.headers, ...options?.headers } : undefined;
	return new GoogleGenAI({
		vertexai: true,
		project: resolveProject(options),
		location: resolveLocation(options),
		apiVersion: API_VERSION,
		httpOptions: headers ? { headers } : undefined,
	});
}

function resolveProject(options?: GoogleVertexOptions): string {
	const project = options?.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
	if (!project) {
		throw new Error(
			"Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or pass project in options.",
		);
	}
	return project;
}

function resolveLocation(options?: GoogleVertexOptions): string {
	const location = options?.location || process.env.GOOGLE_CLOUD_LOCATION;
	if (!location) {
		throw new Error("Vertex AI requires a location. Set GOOGLE_CLOUD_LOCATION or pass location in options.");
	}
	return location;
}
