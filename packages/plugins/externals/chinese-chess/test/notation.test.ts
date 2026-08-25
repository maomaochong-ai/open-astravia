import { describe, expect, it } from "vitest";
import { XiangqiEngine } from "../src/game/engine";
import { moveToIccs, parseIccs, pieceChar, toChineseNotation } from "../src/game/notation";

describe("coordinate notation", () => {
	it("round-trips iccs coordinates", () => {
		expect(moveToIccs({ x: 1, y: 7 }, { x: 4, y: 7 })).toBe("b7e7");
		expect(parseIccs("b7e7")).toEqual({ from: { x: 1, y: 7 }, to: { x: 4, y: 7 } });
		expect(parseIccs(" I9A0 ")).toEqual({ from: { x: 8, y: 9 }, to: { x: 0, y: 0 } });
		expect(parseIccs("z9a0")).toBeNull();
		expect(parseIccs("a9a")).toBeNull();
	});

	it("uses conventional piece characters per side", () => {
		expect(pieceChar("RED", "general")).toBe("帅");
		expect(pieceChar("BLACK", "general")).toBe("将");
		expect(pieceChar("RED", "pawn")).toBe("兵");
		expect(pieceChar("BLACK", "pawn")).toBe("卒");
	});
});

describe("chinese move notation", () => {
	it("matches zh-chess own notation parsing on opening moves", () => {
		const engine = new XiangqiEngine();
		const pieces = engine.pieces();
		// 红炮二平五：zh-chess resolves 炮二 to the cannon at (1,7)
		expect(toChineseNotation(pieces, { x: 1, y: 7 }, { x: 4, y: 7 }, "RED")).toBe("炮二平五");
		// 红马八进七
		expect(toChineseNotation(pieces, { x: 7, y: 9 }, { x: 6, y: 7 }, "RED")).toBe("马八进七");
		// 黑炮8平5：black files count 9-x with arabic digits
		expect(toChineseNotation(pieces, { x: 1, y: 2 }, { x: 4, y: 2 }, "BLACK")).toBe("炮8平5");
		// 红兵三进一 straight advance counts steps
		expect(toChineseNotation(pieces, { x: 2, y: 6 }, { x: 2, y: 5 }, "RED")).toBe("兵三进一");
		// 黑卒3进1
		expect(toChineseNotation(pieces, { x: 6, y: 3 }, { x: 6, y: 4 }, "BLACK")).toBe("卒3进1");
	});

	it("disambiguates stacked pieces with 前/后", () => {
		// Two red rooks on file x=4 (red file 五), front = smaller y for RED.
		const pieces = [
			{ side: "RED" as const, type: "rook" as const, x: 4, y: 5 },
			{ side: "RED" as const, type: "rook" as const, x: 4, y: 8 },
			{ side: "RED" as const, type: "general" as const, x: 4, y: 9 },
		];
		expect(toChineseNotation(pieces, { x: 4, y: 5 }, { x: 4, y: 3 }, "RED")).toBe("前车进二");
		expect(toChineseNotation(pieces, { x: 4, y: 8 }, { x: 4, y: 6 }, "RED")).toBe("后车进二");
		expect(toChineseNotation(pieces, { x: 4, y: 5 }, { x: 0, y: 5 }, "RED")).toBe("前车平一");
	});
});
