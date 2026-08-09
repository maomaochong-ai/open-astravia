import { getEnvApiKey } from "../../env-api-keys.js";
import { createResponsesAdapter } from "../openai-responses/adapter.js";
import { processResponsesStream } from "../openai-responses/events.js";
import type { AzureOpenAIResponsesOptions } from "./options.js";
import { buildAzureOpenAIResponsesParams, createAzureOpenAIResponsesClient, resolveDeploymentName } from "./request.js";

export const azureOpenAIResponsesAdapter = createResponsesAdapter<
	"azure-openai-responses",
	AzureOpenAIResponsesOptions
>("azure-openai-responses", async ({ request, output, stream, signal, start }) => {
	const { model, context, options } = request;
	const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
	if (!apiKey) {
		throw new Error(
			"Azure OpenAI API key is required. Set AZURE_OPENAI_API_KEY environment variable or pass it as an argument.",
		);
	}
	const client = createAzureOpenAIResponsesClient(model, apiKey, options);
	const params = buildAzureOpenAIResponsesParams(model, context, options, resolveDeploymentName(model, options));
	options?.onPayload?.(params);
	const providerStream = await client.responses.create(params, signal ? { signal } : undefined);
	start();
	await processResponsesStream(providerStream, output, stream, model);
});
