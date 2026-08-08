import type { Context, Model } from "../../types.js";
import { convertResponsesMessages, convertResponsesTools } from "../openai-responses-shared.js";
import type { CodexRequestBody, OpenAICodexResponsesOptions } from "./options.js";

interface OperatingSystemInfo {
	platform(): string;
	release(): string;
	arch(): string;
}

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

let operatingSystem: OperatingSystemInfo | null = null;
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
	import("node:os").then((module) => {
		operatingSystem = module;
	});
}

export function buildCodexRequestBody(
	model: Model<"openai-codex-responses">,
	context: Context,
	options?: OpenAICodexResponsesOptions,
): CodexRequestBody {
	const body: CodexRequestBody = {
		model: model.id,
		store: false,
		stream: true,
		instructions: context.systemPrompt,
		input: convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
			includeSystemPrompt: false,
		}),
		text: { verbosity: options?.textVerbosity || "medium" },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: options?.sessionId,
		tool_choice: "auto",
		parallel_tool_calls: true,
	};
	if (options?.temperature !== undefined) body.temperature = options.temperature;
	if (context.tools) body.tools = convertResponsesTools(context.tools, { strict: null });
	if (options?.reasoningEffort !== undefined) {
		body.reasoning = {
			effort: clampReasoningEffort(model.id, options.reasoningEffort),
			summary: options.reasoningSummary ?? "auto",
		};
	}
	return body;
}

export function buildCodexHeaders(
	initHeaders: Record<string, string> | undefined,
	additionalHeaders: Record<string, string> | undefined,
	accountId: string,
	token: string,
	sessionId?: string,
): Headers {
	const headers = new Headers(initHeaders);
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("originator", "pi");
	const userAgent = operatingSystem
		? `pi (${operatingSystem.platform()} ${operatingSystem.release()}; ${operatingSystem.arch()})`
		: "pi (browser)";
	headers.set("User-Agent", userAgent);
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");
	for (const [key, value] of Object.entries(additionalHeaders || {})) headers.set(key, value);
	if (sessionId) headers.set("session_id", sessionId);
	return headers;
}

export function extractCodexAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		const payload = JSON.parse(atob(parts[1])) as Record<string, unknown>;
		const auth = payload[JWT_CLAIM_PATH];
		const accountId =
			auth && typeof auth === "object" && "chatgpt_account_id" in auth
				? (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id
				: undefined;
		if (typeof accountId !== "string" || accountId.length === 0) throw new Error("No account ID in token");
		return accountId;
	} catch {
		throw new Error("Failed to extract accountId from token");
	}
}

export function resolveCodexUrl(baseUrl?: string): string {
	const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
	const normalized = raw.replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}

export function resolveCodexWebSocketUrl(baseUrl?: string): string {
	const url = new URL(resolveCodexUrl(baseUrl));
	if (url.protocol === "https:") url.protocol = "wss:";
	if (url.protocol === "http:") url.protocol = "ws:";
	return url.toString();
}

export async function fetchCodexResponse(
	url: string,
	headers: Headers,
	body: string,
	signal?: AbortSignal,
): Promise<Response> {
	let response: Response | undefined;
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (signal?.aborted) throw new Error("Request was aborted");
		try {
			response = await fetch(url, { method: "POST", headers, body, signal });
			if (response.ok) return response;
			const errorText = await response.text();
			if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
				await sleep(BASE_DELAY_MS * 2 ** attempt, signal);
				continue;
			}
			const info = await parseErrorResponse(
				new Response(errorText, { status: response.status, statusText: response.statusText }),
			);
			throw new Error(info.friendlyMessage || info.message);
		} catch (error) {
			if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
				throw new Error("Request was aborted");
			}
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < MAX_RETRIES && !lastError.message.includes("usage limit")) {
				await sleep(BASE_DELAY_MS * 2 ** attempt, signal);
				continue;
			}
			throw lastError;
		}
	}
	throw lastError ?? new Error("Failed after retries");
}

function clampReasoningEffort(modelId: string, effort: string): string {
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	if ((id.startsWith("gpt-5.2") || id.startsWith("gpt-5.3")) && effort === "minimal") return "low";
	if (id === "gpt-5.1" && effort === "xhigh") return "high";
	if (id === "gpt-5.1-codex-mini") return effort === "high" || effort === "xhigh" ? "high" : "medium";
	return effort;
}

function isRetryableError(status: number, errorText: string): boolean {
	if ([429, 500, 502, 503, 504].includes(status)) return true;
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}
		let timeout: ReturnType<typeof setTimeout>;
		const cleanup = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			cleanup();
			reject(new Error("Request was aborted"));
		};
		timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function parseErrorResponse(response: Response): Promise<{ message: string; friendlyMessage?: string }> {
	const raw = await response.text();
	let message = raw || response.statusText || "Request failed";
	let friendlyMessage: string | undefined;
	try {
		const parsed = JSON.parse(raw) as {
			error?: { code?: string; type?: string; message?: string; plan_type?: string; resets_at?: number };
		};
		const error = parsed.error;
		if (error) {
			const code = error.code || error.type || "";
			if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
				const plan = error.plan_type ? ` (${error.plan_type.toLowerCase()} plan)` : "";
				const minutes = error.resets_at
					? Math.max(0, Math.round((error.resets_at * 1000 - Date.now()) / 60000))
					: undefined;
				const when = minutes !== undefined ? ` Try again in ~${minutes} min.` : "";
				friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
			}
			message = error.message || friendlyMessage || message;
		}
	} catch {}
	return { message, friendlyMessage };
}
