import Anthropic from "@anthropic-ai/sdk";
import type { Model } from "../../types.js";

const claudeCodeVersion = "2.1.2";

export function createAnthropicClient(
	model: Model<"anthropic-messages">,
	apiKey: string,
	interleavedThinking: boolean,
	optionsHeaders?: Record<string, string>,
	dynamicHeaders?: Record<string, string>,
): { client: Anthropic; isOAuthToken: boolean } {
	if (model.provider === "github-copilot") {
		const betaFeatures = interleavedThinking ? ["interleaved-thinking-2025-05-14"] : [];
		return {
			client: new Anthropic({
				apiKey: null,
				authToken: apiKey,
				baseURL: model.gatewayUrl || model.baseUrl,
				dangerouslyAllowBrowser: true,
				defaultHeaders: mergeHeaders(
					{
						accept: "application/json",
						"anthropic-dangerous-direct-browser-access": "true",
						...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
					},
					model.headers,
					dynamicHeaders,
					optionsHeaders,
				),
			}),
			isOAuthToken: false,
		};
	}

	const betaFeatures = ["fine-grained-tool-streaming-2025-05-14"];
	if (interleavedThinking) betaFeatures.push("interleaved-thinking-2025-05-14");

	if (isOAuthToken(apiKey)) {
		return {
			client: new Anthropic({
				apiKey: null,
				authToken: apiKey,
				baseURL: model.gatewayUrl || model.baseUrl,
				dangerouslyAllowBrowser: true,
				defaultHeaders: mergeHeaders(
					{
						accept: "application/json",
						"anthropic-dangerous-direct-browser-access": "true",
						"anthropic-beta": `claude-code-20250219,oauth-2025-04-20,${betaFeatures.join(",")}`,
						"user-agent": `claude-cli/${claudeCodeVersion} (external, cli)`,
						"x-app": "cli",
					},
					model.headers,
					optionsHeaders,
				),
			}),
			isOAuthToken: true,
		};
	}

	return {
		client: new Anthropic({
			apiKey,
			baseURL: model.gatewayUrl || model.baseUrl,
			dangerouslyAllowBrowser: true,
			defaultHeaders: mergeHeaders(
				{
					accept: "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
					"anthropic-beta": betaFeatures.join(","),
				},
				model.headers,
				optionsHeaders,
			),
		}),
		isOAuthToken: false,
	};
}

function isOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

function mergeHeaders(...headerSources: (Record<string, string> | undefined)[]): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const headers of headerSources) {
		if (headers) Object.assign(merged, headers);
	}
	return merged;
}
