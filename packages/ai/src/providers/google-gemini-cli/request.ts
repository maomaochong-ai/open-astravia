import type { ThinkingConfig } from "@google/genai";
import type { Context, Model } from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { convertMessages, convertTools, mapToolChoice } from "../google-shared.js";
import type { GoogleGeminiCliOptions } from "./options.js";
import type { CloudCodeAssistRequest } from "./protocol.js";

const DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const ANTIGRAVITY_ENDPOINT_FALLBACKS = [ANTIGRAVITY_DAILY_ENDPOINT, DEFAULT_ENDPOINT] as const;
const DEFAULT_ANTIGRAVITY_VERSION = "1.15.8";
const CLAUDE_THINKING_BETA_HEADER = "interleaved-thinking-2025-05-14";
const ANTIGRAVITY_SYSTEM_INSTRUCTION =
	"You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding." +
	"You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question." +
	"**Absolute paths only**" +
	"**Proactiveness**";

const GEMINI_CLI_HEADERS = {
	"User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
	"X-Goog-Api-Client": "gl-node/22.17.0",
	"Client-Metadata": JSON.stringify({
		ideType: "IDE_UNSPECIFIED",
		platform: "PLATFORM_UNSPECIFIED",
		pluginType: "GEMINI",
	}),
};

export interface GoogleCloudCodeCredentials {
	accessToken: string;
	projectId: string;
}

export function parseGoogleCloudCodeCredentials(apiKeyRaw?: string): GoogleCloudCodeCredentials {
	if (!apiKeyRaw) {
		throw new Error("Google Cloud Code Assist requires OAuth authentication. Use /login to authenticate.");
	}
	let parsed: { token?: string; projectId?: string };
	try {
		parsed = JSON.parse(apiKeyRaw) as { token?: string; projectId?: string };
	} catch {
		throw new Error("Invalid Google Cloud Code Assist credentials. Use /login to re-authenticate.");
	}
	if (!parsed.token || !parsed.projectId) {
		throw new Error("Missing token or projectId in Google Cloud credentials. Use /login to re-authenticate.");
	}
	return { accessToken: parsed.token, projectId: parsed.projectId };
}

export function resolveGoogleCloudCodeEndpoints(model: Model<"google-gemini-cli">): readonly string[] {
	const baseUrl = model.baseUrl?.trim();
	if (baseUrl) return [baseUrl];
	return model.provider === "google-antigravity" ? ANTIGRAVITY_ENDPOINT_FALLBACKS : [DEFAULT_ENDPOINT];
}

export function buildGoogleCloudCodeHeaders(
	model: Model<"google-gemini-cli">,
	accessToken: string,
	options?: GoogleGeminiCliOptions,
): Record<string, string> {
	const providerHeaders = model.provider === "google-antigravity" ? getAntigravityHeaders() : GEMINI_CLI_HEADERS;
	return {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		Accept: "text/event-stream",
		...providerHeaders,
		...(isClaudeThinkingModel(model.id) ? { "anthropic-beta": CLAUDE_THINKING_BETA_HEADER } : {}),
		...options?.headers,
	};
}

export function buildGoogleCloudCodeUrl(endpoint: string): string {
	return `${endpoint}/v1internal:streamGenerateContent?alt=sse`;
}

export function buildRequest(
	model: Model<"google-gemini-cli">,
	context: Context,
	projectId: string,
	options: GoogleGeminiCliOptions = {},
	isAntigravity = false,
): CloudCodeAssistRequest {
	const generationConfig: CloudCodeAssistRequest["request"]["generationConfig"] = {};
	if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
	if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
	if (options.thinking?.enabled && model.reasoning) {
		generationConfig.thinkingConfig = { includeThoughts: true };
		if (options.thinking.level !== undefined) {
			generationConfig.thinkingConfig.thinkingLevel = options.thinking.level as ThinkingConfig["thinkingLevel"];
		} else if (options.thinking.budgetTokens !== undefined) {
			generationConfig.thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
		}
	}

	const request: CloudCodeAssistRequest["request"] = { contents: convertMessages(model, context) };
	request.sessionId = options.sessionId;
	if (context.systemPrompt) {
		request.systemInstruction = { parts: [{ text: sanitizeSurrogates(context.systemPrompt) }] };
	}
	if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
	if (context.tools && context.tools.length > 0) {
		request.tools = convertTools(context.tools, model.id.startsWith("claude-"));
		if (options.toolChoice) {
			request.toolConfig = { functionCallingConfig: { mode: mapToolChoice(options.toolChoice) } };
		}
	}
	if (isAntigravity) {
		const existingParts = request.systemInstruction?.parts ?? [];
		request.systemInstruction = {
			role: "user",
			parts: [
				{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
				{ text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
				...existingParts,
			],
		};
	}
	return {
		project: projectId,
		model: model.id,
		request,
		...(isAntigravity ? { requestType: "agent" } : {}),
		userAgent: isAntigravity ? "antigravity" : "pi-coding-agent",
		requestId: `${isAntigravity ? "agent" : "pi"}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
	};
}

function getAntigravityHeaders(): Record<string, string> {
	const version = process.env.PI_AI_ANTIGRAVITY_VERSION || DEFAULT_ANTIGRAVITY_VERSION;
	return {
		"User-Agent": `antigravity/${version} darwin/arm64`,
		"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
		"Client-Metadata": GEMINI_CLI_HEADERS["Client-Metadata"],
	};
}

function isClaudeThinkingModel(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return normalized.includes("claude") && normalized.includes("thinking");
}
