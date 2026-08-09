import type { StreamOptions } from "../../types.js";

export interface AzureOpenAIResponsesOptions extends StreamOptions {
	reasoningEffort?: string;
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
	azureApiVersion?: string;
	azureResourceName?: string;
	azureBaseUrl?: string;
	azureDeploymentName?: string;
}
