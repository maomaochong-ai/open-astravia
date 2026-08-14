import { AI_ERROR_CODES, AIError, type Api, type AssistantMessage } from "../protocol/index.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import { getDefaultAdapterRegistry } from "./default-adapter-registry.js";
import type { ModelCallRequest, ModelGenerateResponse, ModelStreamResponse } from "./language-model-adapter.js";
import { collectModelCallResult } from "./model-call-result.js";

export async function streamModel<TApi extends Api>(
	request: ModelCallRequest<TApi>,
	registry: AdapterRegistry = getDefaultAdapterRegistry(),
): Promise<ModelStreamResponse> {
	const adapter = registry.get(request.model.api);
	if (!adapter) {
		throw new AIError(AI_ERROR_CODES.UNSUPPORTED_CAPABILITY, `No adapter registered for api: ${request.model.api}`, {
			provider: request.model.provider,
			modelId: request.model.id,
			metadata: { api: request.model.api },
		});
	}
	return adapter.stream(request);
}

export function collectResponse(response: ModelStreamResponse): Promise<AssistantMessage> {
	return response.result;
}

export async function generateModel<TApi extends Api>(
	request: ModelCallRequest<TApi>,
	registry: AdapterRegistry = getDefaultAdapterRegistry(),
): Promise<ModelGenerateResponse> {
	const adapter = registry.get(request.model.api);
	if (!adapter) {
		throw new AIError(AI_ERROR_CODES.UNSUPPORTED_CAPABILITY, `No adapter registered for api: ${request.model.api}`, {
			provider: request.model.provider,
			modelId: request.model.id,
			metadata: { api: request.model.api },
		});
	}
	if (adapter.generate) return adapter.generate(request);
	const response = await adapter.stream(request);
	return { result: collectModelCallResult(response) };
}
