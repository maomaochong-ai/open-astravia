import { GoogleGenAI } from "@google/genai";
import { getEnvApiKey } from "../../env-api-keys.js";
import type { ModelCallRequest } from "../../runtime/language-model-adapter.js";
import type { GoogleOptions } from "./options.js";

export function createGoogleClient(request: ModelCallRequest<"google-generative-ai", GoogleOptions>): GoogleGenAI {
	const { model, options } = request;
	const httpOptions: { baseUrl?: string; apiVersion?: string; headers?: Record<string, string> } = {};
	if (model.baseUrl) {
		httpOptions.baseUrl = model.baseUrl;
		httpOptions.apiVersion = "";
	}
	if (model.headers || options?.headers) httpOptions.headers = { ...model.headers, ...options?.headers };
	return new GoogleGenAI({
		apiKey: options?.apiKey ?? getEnvApiKey(model.provider) ?? "",
		httpOptions: Object.keys(httpOptions).length > 0 ? httpOptions : undefined,
	});
}
