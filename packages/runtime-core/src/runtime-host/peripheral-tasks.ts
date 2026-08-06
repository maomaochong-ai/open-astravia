import {
	type Api,
	completeSimple,
	getReasoningPreset,
	type Model,
	type TextContent,
	type Tool,
	type ToolCall,
	Type,
} from "@vetta/ai";
import type { ModelRegistry } from "@vetta/coding-agent";

/** 周边任务最多尝试几个模型（会话模型优先，再补可用模型）。 */
const PERIPHERAL_MAX_ATTEMPTS = 3;
/** 失败模型进程内冷却时长，避免连打坏模型。 */
const PERIPHERAL_COOLDOWN_MS = 2 * 60 * 1000;
/** key = "provider/modelId" → cooldown until epoch ms */
const peripheralCooldownUntil = new Map<string, number>();

export type PeripheralCandidate = {
	model: Model<Api>;
	apiKey: string;
	reasoning: string | undefined;
	key: string;
};

export type PeripheralModelSource = {
	modelRegistry: ModelRegistry;
	/** 当前会话模型；优先作为候选队首。 */
	sessionModel: Model<Api> | undefined;
};

function peripheralModelKey(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function isPeripheralCoolingDown(key: string): boolean {
	const until = peripheralCooldownUntil.get(key);
	if (until === undefined) return false;
	if (Date.now() >= until) {
		peripheralCooldownUntil.delete(key);
		return false;
	}
	return true;
}

function markPeripheralCooldown(key: string, ms = PERIPHERAL_COOLDOWN_MS): void {
	peripheralCooldownUntil.set(key, Date.now() + ms);
}

/**
 * 解析周边任务(auto-title / 输入预测)的候选模型列表。
 * 优先当前会话模型，再从可用模型补足；跳过冷却中的与无 apiKey 的。
 */
export async function resolvePeripheralCandidates(source: PeripheralModelSource): Promise<PeripheralCandidate[]> {
	const registry = source.modelRegistry;
	registry.refresh();

	const candidates: PeripheralCandidate[] = [];
	const seen = new Set<string>();

	const tryPush = async (model: Model<Api> | undefined) => {
		if (!model || candidates.length >= PERIPHERAL_MAX_ATTEMPTS) return;
		const key = peripheralModelKey(model);
		if (seen.has(key) || isPeripheralCoolingDown(key)) return;
		const apiKey = await registry.getApiKey(model);
		if (!apiKey) return;
		seen.add(key);
		// 周边任务用各 API 最轻 reasoning 档，避免短答案被吞进 thinking 通道。
		const level = getReasoningPreset(model.api)?.levels[0] || "minimal";
		const reasoning = level === "off" ? undefined : level;
		candidates.push({ model, apiKey, reasoning, key });
	};

	await tryPush(source.sessionModel);
	for (const model of registry.getAvailable()) {
		if (candidates.length >= PERIPHERAL_MAX_ATTEMPTS) break;
		await tryPush(model);
	}
	return candidates;
}

/**
 * 按候选列表依次调用，失败则冷却该模型并轮转下一个。
 * run 返回 null 表示本候选失败（可轮转）；返回值则成功结束。
 */
export async function runWithPeripheralFailover<T>(
	source: PeripheralModelSource,
	label: string,
	run: (candidate: PeripheralCandidate) => Promise<T | null>,
): Promise<T | null> {
	const candidates = await resolvePeripheralCandidates(source);
	if (candidates.length === 0) {
		console.warn(`[${label}] skipped: no available model with credentials`);
		return null;
	}
	for (const candidate of candidates) {
		console.log(`[${label}] trying model=${candidate.key}`);
		try {
			const value = await run(candidate);
			if (value !== null) return value;
			console.warn(`[${label}] model=${candidate.key} produced no usable result; rotating`);
			markPeripheralCooldown(candidate.key);
		} catch (err) {
			console.warn(`[${label}] model=${candidate.key} failed:`, err);
			markPeripheralCooldown(candidate.key);
		}
	}
	console.warn(`[${label}] all ${candidates.length} candidate(s) exhausted`);
	return null;
}

/**
 * 输入预测的结构化输出工具：JSON schema 强约束 suggestions 为字符串数组。
 *
 * 描述用英文写：它和下面两个周边任务的提示词一样会进模型上下文，写成中文等于
 * 给模型一个「本次会话说中文」的信号，用户用英文提问也会拿到中文建议。语言由
 * 会话内容决定，不由提示词的语言决定。
 */
const SUGGESTIONS_TOOL: Tool = {
	name: "provide_prompt_suggestions",
	description:
		"Submit the predicted next messages the user is most likely to type and send to the assistant (0-3 items, written in the user's own first-person voice).",
	parameters: Type.Object({
		suggestions: Type.Array(
			Type.String({
				description:
					"One sentence the user would literally type: first person, concrete, conversational, at most ~30 characters of CJK or ~15 words. Written in the same language the user is using.",
			}),
			{
				description:
					"0 to 3 suggestions ordered from most to least likely; return an empty array when there is no sensible follow-up.",
				maxItems: 3,
			},
		),
	}),
};

/** 清洗建议数组：去围栏/引号、去空、去重，最多保留 3 条。 */
export function cleanSuggestionList(items: unknown[]): string[] {
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

/**
 * 文本兜底解析：当模型未调用工具时，从其文本/思考里**只**抽取 JSON 字符串数组。
 * 扫描所有不嵌套的 `[...]` 片段，取最后一个能 JSON.parse 成「字符串数组」的，
 * 这样推理散文与 `[step 1]` 等方括号都不会被误当建议泄漏。
 */
export function sanitizeSuggestions(raw: string): string[] {
	if (!raw) return [];
	let chosen: string[] | null = null;
	for (const m of raw.matchAll(/\[[^[\]]*\]/g)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(m[0]);
		} catch {
			continue;
		}
		if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
			chosen = parsed as string[];
		}
	}
	return chosen ? cleanSuggestionList(chosen) : [];
}

/** 含 CJK 的标题按字数截断，纯拉丁文按更宽的字符数截断（14 个拉丁字符不足两个词）。 */
const TITLE_MAX_CHARS_CJK = 14;
const TITLE_MAX_CHARS_LATIN = 40;

/** 截断到上限，拉丁文在词边界收尾，避免把单词切一半。 */
function capTitle(stripped: string): string {
	const hasCjk = /[㐀-鿿豈-﫿぀-ヿ가-힯]/u.test(stripped);
	const limit = hasCjk ? TITLE_MAX_CHARS_CJK : TITLE_MAX_CHARS_LATIN;
	const chars = Array.from(stripped);
	if (chars.length <= limit) return stripped;
	const cut = chars.slice(0, limit).join("");
	if (hasCjk) return cut;
	const lastSpace = cut.lastIndexOf(" ");
	return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

export function sanitizeAutoTitle(raw: string): string {
	if (!raw) return "";
	// Reasoning models often emit a long internal monologue ending with the
	// final short answer. Heuristic: prefer the LAST non-empty line if it is
	// reasonably short (≤ 60 chars — an English title runs far longer than a
	// CJK one), else fall back to the first non-empty line.
	const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length === 0) return "";
	const lastLine = lines[lines.length - 1];
	const firstLine = lines[0];
	const candidate = Array.from(lastLine.trim()).length <= 60 ? lastLine : firstLine;
	// Strip leading/trailing whitespace and any special characters so both ends
	// are alphanumeric (letters, including CJK, or digits).
	const stripped = candidate.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
	if (!stripped) return "";
	return capTitle(stripped);
}

/**
 * Generate a short title from the first round of conversation.
 * Returns the cleaned title, or null when no model is available / all failed.
 * Caller is responsible for persisting via setSessionName.
 */
export async function generateAutoTitle(
	source: PeripheralModelSource,
	sessionId: string,
	userText: string,
	assistantText: string,
): Promise<string | null> {
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

	return runWithPeripheralFailover(source, `autoTitleSession session=${sessionId}`, async (candidate) => {
		const { model, apiKey, reasoning, key } = candidate;
		const startedAt = Date.now();
		console.log(
			`[autoTitleSession] session=${sessionId} model=${key} userLen=${userText.length} assistantLen=${assistantText.length}`,
		);
		const response = await completeSimple(
			model,
			{
				systemPrompt:
					"You are a session title generator. Output exactly one short title and nothing else, in the same language as the user's message.",
				messages: [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: promptText }],
						timestamp: Date.now(),
					},
				],
			},
			// reasoning = API 最轻安全档，使 reasoning 模型把答案写到 text 通道。
			{ apiKey, maxTokens: 256, reasoning },
		);
		const durationMs = Date.now() - startedAt;
		if (response.stopReason === "error") {
			console.warn(
				`[autoTitleSession] session=${sessionId} model=${key} durationMs=${durationMs} stopReason=error message=${
					(response as { errorMessage?: string }).errorMessage ?? "(none)"
				}`,
			);
			return null;
		}
		const rawText = response.content
			.filter((c): c is TextContent => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();
		// Fallback: some reasoning models (e.g. gpt-oss) route the whole short
		// answer through the thinking channel. Use thinking content as a
		// candidate when no plain text was produced.
		const rawThinking = response.content
			.filter((c): c is { type: "thinking"; thinking: string } => c.type === "thinking")
			.map((c) => c.thinking)
			.join("\n")
			.trim();
		const raw = rawText || rawThinking;
		const title = sanitizeAutoTitle(raw);
		console.log(
			`[autoTitleSession] session=${sessionId} model=${key} durationMs=${durationMs} textLen=${rawText.length} thinkingLen=${rawThinking.length} cleaned=${JSON.stringify(title)}`,
		);
		return title || null;
	});
}

/**
 * 输入预测：基于最近几轮对话，预测用户下一个可能输入的 prompt。
 * 返回 0-3 条建议。无可用模型或全部失败时返回 []。
 * 模型成功返回空建议视为合法结果，不轮转。
 */
export async function generateNextPromptSuggestions(
	source: PeripheralModelSource,
	sessionId: string,
	conversation: string,
): Promise<string[]> {
	const trimmed = conversation.trim().slice(0, 4000);
	if (!trimmed) return [];

	const promptText =
		`Below is the recent conversation between a user and an AI assistant. Take the USER's point of view and predict the next message the user is most likely to type and send.\n\n` +
		`Rules:\n` +
		`- Write every suggestion in the SAME LANGUAGE the user is using in the conversation. If the user writes in English, the suggestions are in English.\n` +
		`- Each one must be a sentence the user would literally send: first person, conversational, concrete. For example "write me a sadder ending", "translate this story into Chinese", "add comments to the code you just wrote".\n` +
		`- Never output analysis of the user's intent, third-person descriptions, reasoning or explanation. Only what the user would say.\n` +
		`- 0 to 3 items, most likely first; return an empty array when the conversation has wrapped up and no follow-up makes sense. Keep each under ~30 characters of CJK or ~15 words.\n` +
		`- You MUST submit the result by calling the provide_prompt_suggestions tool (suggestions field). Do not answer with plain text.\n\n` +
		`<conversation>\n${trimmed}\n</conversation>`;

	// null = 调用失败需轮转；[] = 成功但无建议（合法，不轮转）。
	const result = await runWithPeripheralFailover(
		source,
		`nextPromptSuggestions session=${sessionId}`,
		async (candidate) => {
			const { model, apiKey, reasoning, key } = candidate;
			const response = await completeSimple(
				model,
				{
					systemPrompt:
						"You are an input predictor. Imitate the user's voice to predict their next message, in the language the user is writing in. You MUST call the provide_prompt_suggestions tool and submit 0-3 concrete first-person questions or instructions in the suggestions field, with no analysis or reasoning.",
					messages: [
						{
							role: "user" as const,
							content: [{ type: "text" as const, text: promptText }],
							timestamp: Date.now(),
						},
					],
					tools: [SUGGESTIONS_TOOL],
				},
				{ apiKey, maxTokens: 800, reasoning },
			);
			if (response.stopReason === "error") {
				console.warn(
					`[nextPromptSuggestions] session=${sessionId} model=${key} stopReason=error message=${
						(response as { errorMessage?: string }).errorMessage ?? "(none)"
					}`,
				);
				return null;
			}
			// 首选：结构化工具调用，arguments 已是解析好的对象（JSON schema 保证形状）。
			const toolCall = response.content.find(
				(c): c is ToolCall => c.type === "toolCall" && c.name === SUGGESTIONS_TOOL.name,
			);
			if (toolCall) {
				const rawList = (toolCall.arguments as { suggestions?: unknown }).suggestions;
				return Array.isArray(rawList) ? cleanSuggestionList(rawList) : [];
			}
			// 兜底：模型没调用工具，从正式回答 / 思考通道里扫 JSON 数组（仅认 JSON，
			// 思考散文不会被误当建议泄漏）。
			const rawText = response.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("")
				.trim();
			const rawThinking = response.content
				.filter((c): c is { type: "thinking"; thinking: string } => c.type === "thinking")
				.map((c) => c.thinking)
				.join("\n")
				.trim();
			const fromText = sanitizeSuggestions(rawText);
			if (fromText.length > 0) return fromText;
			const fromThinking = sanitizeSuggestions(rawThinking);
			if (fromThinking.length > 0) return fromThinking;
			// 成功响应但解析不出建议：视为合法空结果（对话可能已收尾），不轮转。
			return [];
		},
	);
	return result ?? [];
}
