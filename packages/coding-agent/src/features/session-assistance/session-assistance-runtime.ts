import {
	type Api,
	completeSimple,
	getReasoningPreset,
	type Model,
	normalizeAssistantMessageError,
	type TextContent,
	type Tool,
	type ToolCall,
	Type,
} from "@vetta/ai";
import type { RuntimeSessionModelView } from "@vetta/runtime-core";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "@vetta/runtime-core/observation";
import { CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION } from "../../runtime-contracts/session-assistance-observability.js";

const MAX_CANDIDATES = 3;
const MODEL_COOLDOWN_MS = 2 * 60 * 1000;
const modelCooldownUntil = new Map<string, number>();

export interface CodingAgentSessionAssistanceRuntimeOptions {
	readonly models: RuntimeSessionModelView;
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly now?: () => number;
}

export interface CodingAgentSessionAssistanceCandidate {
	readonly model: Model<Api>;
	readonly apiKey: string;
	readonly reasoning: string | undefined;
	readonly key: string;
}

/** Coding 产品的标题和下一输入建议；Runtime Core 只提供模型只读 Port 和 Endpoint 路由。 */
export class CodingAgentSessionAssistanceRuntime {
	private readonly now: () => number;

	constructor(private readonly options: CodingAgentSessionAssistanceRuntimeOptions) {
		this.now = options.now ?? Date.now;
	}

	async generateTitle(userText: string, assistantText: string): Promise<string | null> {
		const trimmedUser = userText.trim().slice(0, 800);
		const trimmedAssistant = assistantText.trim().slice(0, 1500);
		const promptText =
			`Write a short title for the conversation below. It labels this session in the sidebar.\n` +
			`Rules:\n` +
			`- Write it in the SAME LANGUAGE as the user message. If the user wrote in English, the title is in English.\n` +
			`- Keep it short: 10-20 characters for CJK, or 3-6 words for languages written with spaces.\n` +
			`- Output the title itself only. No quotes, no trailing punctuation, no explanation, no prefix or suffix.\n\n` +
			`<user_message>\n${trimmedUser}\n</user_message>\n\n` +
			`<assistant_reply>\n${trimmedAssistant}\n</assistant_reply>`;

		return this.runWithFailover("title.generate", async ({ model, apiKey, reasoning }) => {
			const response = await completeSimple(
				model,
				{
					systemPrompt:
						"You are a session title generator. Output exactly one short title and nothing else, in the same language as the user's message.",
					messages: [
						{
							role: "user" as const,
							content: [{ type: "text" as const, text: promptText }],
							timestamp: this.now(),
						},
					],
				},
				{ apiKey, maxTokens: 256, reasoning },
			);
			if (response.stopReason === "error") {
				throw toModelFailure(normalizeAssistantMessageError(response, model));
			}
			const rawText = readText(response.content);
			const rawThinking = readThinking(response.content);
			return sanitizeAutoTitle(rawText || rawThinking) || null;
		});
	}

	async generateNextPrompts(conversation: string): Promise<readonly string[]> {
		const trimmed = conversation.trim().slice(0, 4000);
		if (!trimmed) return [];
		const promptText =
			`Below is the recent conversation between a user and an AI assistant. Take the USER's point of view and predict the next message the user is most likely to type and send.\n\n` +
			`Rules:\n` +
			`- Write every suggestion in the SAME LANGUAGE the user is using in the conversation. If the user writes in English, the suggestions are in English.\n` +
			`- Each one must be a sentence the user would literally send: first person, conversational, concrete.\n` +
			`- Never output analysis of the user's intent, third-person descriptions, reasoning or explanation. Only what the user would say.\n` +
			`- 0 to 3 items, most likely first; return an empty array when no follow-up makes sense. Keep each under ~30 characters of CJK or ~15 words.\n` +
			`- You MUST submit the result by calling the provide_prompt_suggestions tool.\n\n` +
			`<conversation>\n${trimmed}\n</conversation>`;

		const result = await this.runWithFailover("next-prompts.generate", async ({ model, apiKey, reasoning }) => {
			const response = await completeSimple(
				model,
				{
					systemPrompt:
						"You are an input predictor. Imitate the user's voice to predict their next message, in the language the user is writing in. You MUST call the provide_prompt_suggestions tool and submit 0-3 concrete first-person questions or instructions in the suggestions field, with no analysis or reasoning.",
					messages: [
						{
							role: "user" as const,
							content: [{ type: "text" as const, text: promptText }],
							timestamp: this.now(),
						},
					],
					tools: [SUGGESTIONS_TOOL],
				},
				{ apiKey, maxTokens: 800, reasoning },
			);
			if (response.stopReason === "error") {
				throw toModelFailure(normalizeAssistantMessageError(response, model));
			}
			const toolCall = response.content.find(
				(content): content is ToolCall => content.type === "toolCall" && content.name === SUGGESTIONS_TOOL.name,
			);
			if (toolCall) {
				const rawList = (toolCall.arguments as { suggestions?: unknown }).suggestions;
				return Array.isArray(rawList) ? cleanSuggestionList(rawList) : [];
			}
			const fromText = sanitizeSuggestions(readText(response.content));
			return fromText.length > 0 ? fromText : sanitizeSuggestions(readThinking(response.content));
		});
		return result ?? [];
	}

	private async runWithFailover<T>(
		operation: "title.generate" | "next-prompts.generate",
		run: (candidate: CodingAgentSessionAssistanceCandidate) => Promise<T | null>,
	): Promise<T | null> {
		this.options.observationPublisher?.record(CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION, {
			operation,
			phase: "started",
		});
		const candidates = await resolveSessionAssistanceCandidates(this.options.models, this.now);
		for (const [index, candidate] of candidates.entries()) {
			const startedAt = this.now();
			try {
				const value = await run(candidate);
				if (value !== null) {
					this.options.observationPublisher?.record(CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION, {
						operation,
						phase: "completed",
						modelProvider: candidate.model.provider,
						modelId: candidate.model.id,
						attempt: index + 1,
						durationMs: Math.max(0, this.now() - startedAt),
						resultCount: Array.isArray(value) ? value.length : 1,
					});
					return value;
				}
				markModelCooldown(candidate.key, this.now);
				this.options.observationPublisher?.record(CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION, {
					operation,
					phase: "candidate-empty",
					modelProvider: candidate.model.provider,
					modelId: candidate.model.id,
					attempt: index + 1,
					durationMs: Math.max(0, this.now() - startedAt),
					resultCount: 0,
				});
			} catch (error) {
				markModelCooldown(candidate.key, this.now);
				this.options.observationPublisher?.record(CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION, {
					operation,
					phase: "candidate-failed",
					modelProvider: candidate.model.provider,
					modelId: candidate.model.id,
					attempt: index + 1,
					durationMs: Math.max(0, this.now() - startedAt),
					failure: runtimeObservationFailure(error),
				});
			}
		}
		this.options.observationPublisher?.record(CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION, {
			operation,
			phase: "exhausted",
			resultCount: 0,
		});
		return null;
	}
}

export async function resolveSessionAssistanceCandidates(
	source: RuntimeSessionModelView,
	now: () => number = Date.now,
): Promise<readonly CodingAgentSessionAssistanceCandidate[]> {
	source.refreshAvailableModels();
	const candidates: CodingAgentSessionAssistanceCandidate[] = [];
	const seen = new Set<string>();
	const add = async (model: Model<Api> | undefined): Promise<void> => {
		if (!model || candidates.length >= MAX_CANDIDATES) return;
		const key = `${model.provider}/${model.id}`;
		if (seen.has(key) || isModelCoolingDown(key, now)) return;
		const apiKey = await source.resolveApiKey(model);
		if (!apiKey) return;
		seen.add(key);
		const level = getReasoningPreset(model.api)?.levels[0] || "minimal";
		candidates.push({ model, apiKey, reasoning: level === "off" ? undefined : level, key });
	};
	await add(source.readCurrentModel());
	for (const model of source.readAvailableModels()) {
		await add(model);
		if (candidates.length >= MAX_CANDIDATES) break;
	}
	return candidates;
}

export function cleanSuggestionList(items: readonly unknown[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of items) {
		if (typeof item !== "string") continue;
		const cleaned = item
			.replace(/^[\s"'`「『《<[(（【“”‘’]+/, "")
			.replace(/[\s"'`」』》>\])）】“”‘’]+$/, "")
			.trim();
		if (!cleaned || seen.has(cleaned)) continue;
		seen.add(cleaned);
		result.push(cleaned);
		if (result.length >= 3) break;
	}
	return result;
}

export function sanitizeSuggestions(raw: string): string[] {
	if (!raw) return [];
	let chosen: string[] | undefined;
	for (const match of raw.matchAll(/\[[^[\]]*\]/g)) {
		try {
			const parsed: unknown = JSON.parse(match[0]);
			if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) chosen = parsed;
		} catch {
			// Model fallback text is untrusted and may contain unrelated bracket expressions.
		}
	}
	return chosen ? cleanSuggestionList(chosen) : [];
}

export function sanitizeAutoTitle(raw: string): string {
	const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length === 0) return "";
	const lastLine = lines[lines.length - 1];
	const candidate = Array.from(lastLine.trim()).length <= 60 ? lastLine : lines[0];
	const stripped = candidate.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
	if (!stripped) return "";
	const hasCjk = /[㐀-鿿豈-﫿぀-ヿ가-힯]/u.test(stripped);
	const limit = hasCjk ? 14 : 40;
	const chars = Array.from(stripped);
	if (chars.length <= limit) return stripped;
	const cut = chars.slice(0, limit).join("");
	if (hasCjk) return cut;
	const lastSpace = cut.lastIndexOf(" ");
	return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function readText(content: readonly unknown[]): string {
	return content
		.filter((item): item is TextContent => isRecord(item) && item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("")
		.trim();
}

function readThinking(content: readonly unknown[]): string {
	return content
		.filter(
			(item): item is { readonly type: "thinking"; readonly thinking: string } =>
				isRecord(item) && item.type === "thinking" && typeof item.thinking === "string",
		)
		.map((item) => item.thinking)
		.join("\n")
		.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isModelCoolingDown(key: string, now: () => number): boolean {
	const until = modelCooldownUntil.get(key);
	if (until === undefined) return false;
	if (now() < until) return true;
	modelCooldownUntil.delete(key);
	return false;
}

function markModelCooldown(key: string, now: () => number): void {
	modelCooldownUntil.set(key, now() + MODEL_COOLDOWN_MS);
}

function toModelFailure(failure: ReturnType<typeof normalizeAssistantMessageError>): Error {
	return Object.assign(new Error("Session assistance model call failed"), {
		name: "SessionAssistanceModelError",
		code: failure.code,
	});
}

const SUGGESTIONS_TOOL: Tool = {
	name: "provide_prompt_suggestions",
	description:
		"Submit the predicted next messages the user is most likely to type and send to the assistant (0-3 items, written in the user's own first-person voice).",
	parameters: Type.Object({
		suggestions: Type.Array(Type.String(), { maxItems: 3 }),
	}),
};
