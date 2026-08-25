import type { PluginAiChatRequest, PluginAiChatResult } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { buildTurnMessage, pickFallbackMove, playAgentTurn } from "../src/game/agent-player";
import { XiangqiEngine } from "../src/game/engine";
import { moveToIccs } from "../src/game/notation";

function chatResult(partial: Partial<PluginAiChatResult>): PluginAiChatResult {
	return {
		modelKey: "test/model",
		text: "",
		toolCalls: [],
		stopReason: "stop",
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		...partial,
	};
}

function scriptedAi(script: Array<(request: PluginAiChatRequest) => PluginAiChatResult>) {
	const requests: PluginAiChatRequest[] = [];
	let call = 0;
	return {
		requests,
		ai: {
			chat: async (request: PluginAiChatRequest): Promise<PluginAiChatResult> => {
				requests.push(request);
				const step = script[Math.min(call, script.length - 1)];
				call += 1;
				return step(request);
			},
		},
	};
}

describe("buildTurnMessage", () => {
	it("includes the board, the PEN and every legal move", () => {
		const engine = new XiangqiEngine();
		const message = buildTurnMessage(engine, "RED");
		expect(message).toContain(engine.pen);
		expect(message).toContain("b7e7");
		expect(message).toContain("合法着法");
		for (const move of engine.legalMoves("RED").slice(0, 5)) {
			expect(message).toContain(moveToIccs(move.from, move.to));
		}
	});

	it("mentions the opponent's previous move", () => {
		const engine = new XiangqiEngine();
		engine.move({ x: 1, y: 7 }, { x: 4, y: 7 });
		const message = buildTurnMessage(engine, "BLACK", {
			iccs: "b7e7",
			side: "RED",
			notation: "炮二平五",
			check: false,
		});
		expect(message).toContain("炮二平五");
	});
});

describe("playAgentTurn", () => {
	it("applies the tool-called move and reports commentary", async () => {
		const engine = new XiangqiEngine();
		const { ai, requests } = scriptedAi([
			() =>
				chatResult({
					text: "当头炮，看你怎么应。",
					toolCalls: [{ id: "c1", name: "make_move", arguments: { move: "b7e7" } }],
					stopReason: "toolUse",
				}),
		]);
		const result = await playAgentTurn({ ai, engine, agentSide: "RED", modelKey: "m/k", transcript: [] });
		expect(result.record.iccs).toBe("b7e7");
		expect(result.record.notation).toBe("炮二平五");
		expect(result.commentary).toContain("当头炮");
		expect(result.fallbackUsed).toBe(false);
		expect(engine.turn).toBe("BLACK");
		expect(requests[0]?.modelKey).toBe("m/k");
		expect(requests[0]?.tools?.[0]?.name).toBe("make_move");
		// transcript ends with the successful toolResult
		expect(result.transcript.at(-1)).toMatchObject({ role: "toolResult", toolName: "make_move" });
	});

	it("rejects an illegal move, lets the model retry, then succeeds", async () => {
		const engine = new XiangqiEngine();
		const { ai } = scriptedAi([
			() => chatResult({ toolCalls: [{ id: "c1", name: "make_move", arguments: { move: "a0a5" } }], stopReason: "toolUse" }),
			() => chatResult({ toolCalls: [{ id: "c2", name: "make_move", arguments: { move: "b7e7" } }], stopReason: "toolUse" }),
		]);
		const result = await playAgentTurn({ ai, engine, agentSide: "RED", modelKey: null, transcript: [] });
		expect(result.record.iccs).toBe("b7e7");
		expect(result.fallbackUsed).toBe(false);
		const errorResult = result.transcript.find((m) => m.role === "toolResult" && m.isError === true);
		expect(errorResult).toBeDefined();
	});

	it("falls back to a legal move when the model never produces one", async () => {
		const engine = new XiangqiEngine();
		const { ai, requests } = scriptedAi([() => chatResult({ text: "我在思考……" })]);
		const result = await playAgentTurn({ ai, engine, agentSide: "RED", modelKey: null, transcript: [] });
		expect(result.fallbackUsed).toBe(true);
		expect(result.record.side).toBe("RED");
		expect(engine.turn).toBe("BLACK");
		expect(requests.length).toBe(3);
	});

	it("keeps the transcript bounded", async () => {
		const engine = new XiangqiEngine();
		const longTranscript = Array.from({ length: 80 }, (_, i) => ({
			role: "user" as const,
			content: `msg ${i}`,
		}));
		const { ai } = scriptedAi([
			() => chatResult({ toolCalls: [{ id: "c1", name: "make_move", arguments: { move: "b7e7" } }], stopReason: "toolUse" }),
		]);
		const result = await playAgentTurn({ ai, engine, agentSide: "RED", modelKey: null, transcript: longTranscript });
		expect(result.transcript.length).toBeLessThanOrEqual(43);
		expect(result.transcript[0]?.role).toBe("user");
	});
});

describe("pickFallbackMove", () => {
	it("prefers the highest-value capture", () => {
		// Red rook can capture the black rook straight ahead or a pawn sideways.
		const engine = new XiangqiEngine("4k4/9/9/r8/9/R2p5/9/9/9/3K5 w");
		const move = pickFallbackMove(engine, "RED", () => 0);
		expect(move.iccs).toBe("a5a3");
	});

	it("returns a legal move when nothing can be captured", () => {
		const engine = new XiangqiEngine();
		const move = pickFallbackMove(engine, "RED", () => 0.5);
		const legal = engine.legalMoves("RED").map((m) => moveToIccs(m.from, m.to));
		expect(legal).toContain(move.iccs);
	});
});
