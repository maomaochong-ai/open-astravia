import type { PluginAiChatMessage, PluginAiChatRequest, PluginAiChatResult, PluginAiToolCall } from "@vetta-org/plugin-sdk";
import type { XiangqiEngine } from "./engine";
import { moveToIccs, parseIccs } from "./notation";
import type { MoveRecord, Side } from "./types";

/** The one host capability the loop needs; narrow so tests can fake it. */
export interface AgentChatPort {
	chat(request: PluginAiChatRequest): Promise<PluginAiChatResult>;
}

export interface AgentTurnOptions {
	ai: AgentChatPort;
	engine: XiangqiEngine;
	agentSide: Side;
	modelKey: string | null;
	/** Existing transcript; the turn appends to a copy and returns it. */
	transcript: readonly PluginAiChatMessage[];
	/** Last opponent move shown to the model for context. */
	lastOpponentMove?: MoveRecord;
	signal?: AbortSignal;
}

export interface AgentTurnResult {
	transcript: PluginAiChatMessage[];
	record: MoveRecord;
	/** Commentary text the model produced this turn (may be empty). */
	commentary: string;
	/** The model failed to produce a legal move and the plugin picked one. */
	fallbackUsed: boolean;
	over: boolean;
	winner: Side | null;
}

const MAKE_MOVE_TOOL = {
	name: "make_move",
	description:
		"落子。move 必须是「当前合法着法」列表里的一项（坐标格式，如 b7e7：列 a-i 从左到右，行 0-9）。不在列表里的走法会被拒绝并要求重走。",
	parameters: {
		type: "object",
		properties: {
			move: { type: "string", description: "要走的着法，必须从合法着法列表中选择，例如 b7e7" },
		},
		required: ["move"],
		additionalProperties: false,
	},
} as const;

const MAX_MODEL_ATTEMPTS = 3;
/** Keep the transcript bounded; every turn restates the full position anyway. */
const TRANSCRIPT_LIMIT = 40;

const SIDE_LABEL: Record<Side, string> = { RED: "红方", BLACK: "黑方" };

export function buildSystemPrompt(agentSide: Side): string {
	return [
		`你是一位中国象棋棋手，执${SIDE_LABEL[agentSide]}，正在与用户对弈。`,
		"每一轮你会收到当前局面（文字棋盘 + 当前全部合法着法列表）。",
		"规则：",
		"1. 你必须调用 make_move 工具走棋，走法必须从合法着法列表中选择。",
		"2. 走棋之外，用一两句简短的中文点评本步棋或局势——像真实棋手一样，自信、克制、偶尔幽默，不要复述坐标。",
		"3. 认真下棋：优先考虑将军、吃子、防守要点与子力协调，不要送子。",
	].join("\n");
}

/**
 * Build the per-turn position message. The position is restated in full every
 * turn, so older transcript entries only carry conversational flavor and can be
 * trimmed freely.
 */
export function buildTurnMessage(engine: XiangqiEngine, agentSide: Side, lastOpponentMove?: MoveRecord): string {
	const legal = engine.legalMoves(agentSide).map((move) => {
		const iccs = moveToIccs(move.from, move.to);
		return move.captured ? `${iccs}(吃${move.captured})` : iccs;
	});
	const lines = [
		lastOpponentMove ? `对方刚走了：${lastOpponentMove.notation}（${lastOpponentMove.iccs}）。` : "对局开始。",
		"当前棋盘（行 9 在上，列 0-8 从左到右；你的坐标走法用 列字母a-i + 行数字）：",
		engine.textBoard(),
		`局面 PEN：${engine.pen}`,
		`轮到你（${SIDE_LABEL[agentSide]}）走棋。当前合法着法：`,
		legal.join(", "),
		"请调用 make_move 走一步，并附上简短点评。",
	];
	return lines.join("\n");
}

function trimTranscript(messages: PluginAiChatMessage[]): PluginAiChatMessage[] {
	if (messages.length <= TRANSCRIPT_LIMIT) return messages;
	const trimmed = messages.slice(messages.length - TRANSCRIPT_LIMIT);
	// Never start the transcript with an orphan toolResult: drop up to the first user turn.
	const firstUser = trimmed.findIndex((message) => message.role === "user");
	return firstUser <= 0 ? trimmed : trimmed.slice(firstUser);
}

/** Prefer the highest-value capture, otherwise a random legal move. */
export function pickFallbackMove(engine: XiangqiEngine, side: Side, random: () => number = Math.random): { iccs: string } {
	const moves = engine.legalMoves(side);
	if (moves.length === 0) throw new Error("no legal moves for fallback");
	const value: Record<string, number> = { rook: 9, cannon: 4.5, horse: 4, elephant: 2, advisor: 2, pawn: 2, general: 100 };
	let best = moves.filter((move) => move.captured !== null);
	if (best.length > 0) {
		const top = Math.max(...best.map((move) => value[move.captured ?? "pawn"]));
		best = best.filter((move) => value[move.captured ?? "pawn"] === top);
	} else {
		best = moves;
	}
	const chosen = best[Math.floor(random() * best.length)] ?? moves[0];
	return { iccs: moveToIccs(chosen.from, chosen.to) };
}

function extractMoveArg(call: PluginAiToolCall): string | null {
	const raw = call.arguments["move"];
	return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Run one full agent turn: ask the model for a move via the plugin-internal
 * make_move tool, retry on illegal output, and fall back to a locally chosen
 * legal move when the model keeps failing. Always ends with exactly one move
 * applied to the engine (the engine must not be game-over on entry).
 */
export async function playAgentTurn(options: AgentTurnOptions): Promise<AgentTurnResult> {
	const { ai, engine, agentSide, modelKey, lastOpponentMove } = options;
	const messages: PluginAiChatMessage[] = trimTranscript([
		...options.transcript,
		{ role: "user", content: buildTurnMessage(engine, agentSide, lastOpponentMove) },
	]);
	const commentaryParts: string[] = [];

	const applyIccs = (iccs: string): ReturnType<XiangqiEngine["move"]> | null => {
		const parsed = parseIccs(iccs);
		if (!parsed) return null;
		return engine.move(parsed.from, parsed.to);
	};

	for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
		if (options.signal?.aborted) throw new Error("aborted");
		let turn: PluginAiChatResult;
		try {
			turn = await ai.chat({
				...(modelKey === null ? {} : { modelKey }),
				systemPrompt: buildSystemPrompt(agentSide),
				messages,
				tools: [MAKE_MOVE_TOOL],
				temperature: 0.7,
				maxTokens: 1_024,
			});
		} catch (error) {
			if (attempt < MAX_MODEL_ATTEMPTS - 1) continue;
			throw error;
		}
		messages.push({
			role: "assistant",
			content: turn.text,
			...(turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
		});
		if (turn.text.trim().length > 0) commentaryParts.push(turn.text.trim());

		const moveCall = turn.toolCalls.find((call) => call.name === MAKE_MOVE_TOOL.name);
		if (!moveCall) {
			// Answer stray tool calls so the transcript stays well-formed, then nudge.
			for (const call of turn.toolCalls) {
				messages.push({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: "未知工具。请调用 make_move 走棋。",
					isError: true,
				});
			}
			if (turn.toolCalls.length === 0) {
				messages.push({ role: "user", content: "你还没有走棋。请调用 make_move 工具，从合法着法列表中选择一步。" });
			}
			continue;
		}

		const iccs = extractMoveArg(moveCall);
		const outcome = iccs === null ? null : applyIccs(iccs);
		if (outcome?.ok && outcome.record) {
			messages.push({
				role: "toolResult",
				toolCallId: moveCall.id,
				toolName: moveCall.name,
				content: `已落子：${outcome.record.notation}（${outcome.record.iccs}）${outcome.record.check ? "，将军！" : ""}`,
			});
			return {
				transcript: messages,
				record: outcome.record,
				commentary: commentaryParts.join("\n"),
				fallbackUsed: false,
				over: outcome.over,
				winner: outcome.winner,
			};
		}
		messages.push({
			role: "toolResult",
			toolCallId: moveCall.id,
			toolName: moveCall.name,
			content: `走法「${iccs ?? "(缺失)"}」不合法，请严格从合法着法列表中重新选择。`,
			isError: true,
		});
	}

	// The model kept failing — play a sensible legal move so the game never stalls.
	const fallback = pickFallbackMove(engine, agentSide);
	const outcome = applyIccs(fallback.iccs);
	if (!outcome?.ok || !outcome.record) throw new Error("fallback move failed");
	messages.push({ role: "user", content: `（系统代你走了 ${outcome.record.notation}，请继续。）` });
	return {
		transcript: messages,
		record: outcome.record,
		commentary: commentaryParts.join("\n"),
		fallbackUsed: true,
		over: outcome.over,
		winner: outcome.winner,
	};
}
