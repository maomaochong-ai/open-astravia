import { GoogleGenAI } from "@google/genai";
import { getEnvApiKey } from "../../env-api-keys.js";
import { requireProviderCredential } from "../../provider-kit/index.js";
import type { ModelCallRequest } from "../../runtime/language-model-adapter.js";
import { resolveProviderMaxAttempts } from "../retry-policy.js";
import type { GoogleOptions } from "./options.js";

export function createGoogleClient(request: ModelCallRequest<"google-generative-ai", GoogleOptions>): GoogleGenAI {
	const { model, options } = request;
	const httpOptions: {
		baseUrl?: string;
		apiVersion?: string;
		headers?: Record<string, string>;
		retryOptions: { attempts: number };
	} = { retryOptions: { attempts: resolveProviderMaxAttempts(options?.maxRetries) } };
	if (model.baseUrl) {
		httpOptions.baseUrl = model.baseUrl;
		httpOptions.apiVersion = "";
	}
	if (model.headers || options?.headers) httpOptions.headers = { ...model.headers, ...options?.headers };
	return new GoogleGenAI({
		apiKey: requireProviderCredential(model, options?.apiKey ?? getEnvApiKey(model.provider)),
		httpOptions,
	});
}
