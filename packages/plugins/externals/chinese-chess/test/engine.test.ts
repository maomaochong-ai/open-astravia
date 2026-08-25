import { describe, expect, it } from "vitest";
import { replayGame, XiangqiEngine } from "../src/game/engine";
import { parseIccs } from "../src/game/notation";
import { INITIAL_PEN } from "../src/game/types";

describe("XiangqiEngine", () => {
	it("starts from the standard opening position with red to move", () => {
		const engine = new XiangqiEngine();
		expect(engine.turn).toBe("RED");
		expect(engine.pen).toBe(INITIAL_PEN);
		expect(engine.pieces()).toHaveLength(32);
		expect(engine.legalMoves()).toHaveLength(44);
		expect(engine.over).toBe(false);
	});

	it("applies legal moves, flips the turn and records capture/notation", () => {
		const engine = new XiangqiEngine();
		const outcome = engine.move({ x: 1, y: 7 }, { x: 4, y: 7 });
		expect(outcome.ok).toBe(true);
		expect(outcome.record).toMatchObject({ iccs: "b7e7", side: "RED", notation: "炮二平五", check: false });
		expect(engine.turn).toBe("BLACK");
		expect(engine.pen.endsWith("b")).toBe(true);
	});

	it("rejects illegal moves and out-of-turn moves without changing state", () => {
		const engine = new XiangqiEngine();
		const pen = engine.pen;
		expect(engine.move({ x: 0, y: 9 }, { x: 0, y: 4 }).ok).toBe(false); // rook through pawn
		expect(engine.move({ x: 0, y: 0 }, { x: 0, y: 1 }).ok).toBe(false); // black piece, red to move
		expect(engine.pen).toBe(pen);
		expect(engine.turn).toBe("RED");
	});

	it("restores a position from PEN including the side to move", () => {
		const engine = new XiangqiEngine("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/4C2C1/9/RNBAKABNR b");
		expect(engine.turn).toBe("BLACK");
		expect(engine.legalMoves()).toHaveLength(45);
		const outcome = engine.move({ x: 1, y: 2 }, { x: 4, y: 2 });
		expect(outcome.ok).toBe(true);
		expect(engine.turn).toBe("RED");
	});

	it("detects checkmate and reports the winner", () => {
		const engine = new XiangqiEngine("4k4/8R/9/9/9/R8/9/9/9/3K5 w");
		const outcome = engine.move({ x: 0, y: 5 }, { x: 0, y: 0 });
		expect(outcome.ok).toBe(true);
		expect(outcome.record?.check).toBe(true);
		expect(outcome.over).toBe(true);
		expect(outcome.winner).toBe("RED");
		expect(engine.over).toBe(true);
		expect(engine.legalMoves()).toHaveLength(0);
		expect(engine.move({ x: 0, y: 0 }, { x: 0, y: 1 }).ok).toBe(false);
	});

	it("reports check for the side to move", () => {
		// Red rook delivers check; black to move must be in check.
		const engine = new XiangqiEngine("4k4/9/9/9/9/4R4/9/9/9/3K5 b");
		expect(engine.inCheck()).toBe(true);
		const escape = new XiangqiEngine("3k5/9/9/9/9/4R4/9/9/9/3K5 b");
		expect(escape.inCheck()).toBe(false);
	});

	it("replays a move history to the identical position", () => {
		const engine = new XiangqiEngine();
		engine.move({ x: 1, y: 7 }, { x: 4, y: 7 });
		engine.move({ x: 1, y: 0 }, { x: 2, y: 2 });
		const replayed = replayGame(["b7e7", "b0c2"], parseIccs);
		expect(replayed.pen).toBe(engine.pen);
		expect(replayed.turn).toBe(engine.turn);
	});

	it("legalTargetsFrom only returns targets of the side to move", () => {
		const engine = new XiangqiEngine();
		expect(engine.legalTargetsFrom({ x: 1, y: 7 }).length).toBeGreaterThan(0);
		expect(engine.legalTargetsFrom({ x: 1, y: 2 })).toHaveLength(0);
	});
});
