import { AzureOpenAI } from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { Context, Model } from "../../types.js";
import { convertResponsesMessages, convertResponsesTools } from "../openai-responses/messages.js";
import type { AzureOpenAIResponsesOptions } from "./options.js";

const DEFAULT_AZURE_API_VERSION = "v1";
const AZURE_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode", "azure-openai-responses"]);

type ResponsesReasoning = NonNullable<ResponseCreateParamsStreaming["reasoning"]>;

export function resolveDeploymentName(
	model: Model<"azure-openai-responses">,
	options?: AzureOpenAIResponsesOptions,
): string {
	if (options?.azureDeploymentName) return options.azureDeploymentName;
	return parseDeploymentNameMap(process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP).get(model.id) || model.id;
}

export function createAzureOpenAIResponsesClient(
	model: Model<"azure-openai-responses">,
	apiKey: string,
	options?: AzureOpenAIResponsesOptions,
): AzureOpenAI {
	const headers = { ...model.headers };
	Object.assign(headers, options?.headers);
	const { baseUrl, apiVersion } = resolveAzureConfig(model, options);

	return new AzureOpenAI({
		apiKey,
		apiVersion,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers,
		baseURL: baseUrl,
		fetch: options?.fetch,
	});
}

export function buildAzureOpenAIResponsesParams(
	model: Model<"azure-openai-responses">,
	context: Context,
	options: AzureOpenAIResponsesOptions | undefined,
	deploymentName: string,
): ResponseCreateParamsStreaming {
	const messages = convertResponsesMessages(model, context, AZURE_TOOL_CALL_PROVIDERS);
	const params: ResponseCreateParamsStreaming = {
		model: deploymentName,
		input: messages,
		stream: true,
		prompt_cache_key: options?.sessionId,
	};

	if (options?.maxTokens) params.max_output_tokens = options.maxTokens;
	if (options?.temperature !== undefined) params.temperature = options.temperature;
	if (context.tools) params.tools = convertResponsesTools(context.tools);

	if (model.reasoning) {
		if (options?.reasoningEffort || options?.reasoningSummary) {
			params.reasoning = {
				effort: (options.reasoningEffort || "medium") as ResponsesReasoning["effort"],
				summary: options.reasoningSummary || "auto",
			};
			params.include = ["reasoning.encrypted_content"];
		} else if (model.name.toLowerCase().startsWith("gpt-5")) {
			messages.push({
				role: "developer",
				content: [{ type: "input_text", text: "# Juice: 0 !important" }],
			});
		}
	}

	return params;
}

function parseDeploymentNameMap(value: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!value) return map;
	for (const entry of value.split(",")) {
		const [modelId, deploymentName] = entry.trim().split("=", 2);
		if (modelId && deploymentName) map.set(modelId.trim(), deploymentName.trim());
	}
	return map;
}

function resolveAzureConfig(
	model: Model<"azure-openai-responses">,
	options?: AzureOpenAIResponsesOptions,
): { baseUrl: string; apiVersion: string } {
	const apiVersion = options?.azureApiVersion || process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;
	const configuredBaseUrl = options?.azureBaseUrl?.trim() || process.env.AZURE_OPENAI_BASE_URL?.trim();
	const resourceName = options?.azureResourceName || process.env.AZURE_OPENAI_RESOURCE_NAME;
	const baseUrl = configuredBaseUrl || (resourceName ? buildDefaultBaseUrl(resourceName) : model.baseUrl);
	if (!baseUrl) {
		throw new Error(
			"Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or pass azureBaseUrl, azureResourceName, or model.baseUrl.",
		);
	}
	return { baseUrl: baseUrl.replace(/\/+$/, ""), apiVersion };
}

function buildDefaultBaseUrl(resourceName: string): string {
	return `https://${resourceName}.openai.azure.com/openai/v1`;
}
