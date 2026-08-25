import type { BoardPiece, BoardPoint, Side } from "./types";

/**
 * Coordinate notation used to talk to the model and to record history:
 * files `a`-`i` map to x 0-8, rank digits map to y 0-9 (zh-chess board space,
 * RED back rank at y=9). A move is `<from><to>`, e.g. `"b7e7"`.
 */
export function pointToCoord(p: BoardPoint): string {
	return `${String.fromCharCode(97 + p.x)}${p.y}`;
}

export function moveToIccs(from: BoardPoint, to: BoardPoint): string {
	return `${pointToCoord(from)}${pointToCoord(to)}`;
}

export function parseIccs(move: string): { from: BoardPoint; to: BoardPoint } | null {
	const match = /^([a-i])([0-9])([a-i])([0-9])$/.exec(move.trim().toLowerCase());
	if (!match) return null;
	return {
		from: { x: match[1].charCodeAt(0) - 97, y: Number(match[2]) },
		to: { x: match[3].charCodeAt(0) - 97, y: Number(match[4]) },
	};
}

const RED_PIECE_CHARS: Record<BoardPiece["type"], string> = {
	general: "帅",
	advisor: "仕",
	elephant: "相",
	horse: "马",
	rook: "车",
	cannon: "炮",
	pawn: "兵",
};

const BLACK_PIECE_CHARS: Record<BoardPiece["type"], string> = {
	general: "将",
	advisor: "士",
	elephant: "象",
	horse: "马",
	rook: "车",
	cannon: "炮",
	pawn: "卒",
};

export function pieceChar(side: Side, type: BoardPiece["type"]): string {
	return side === "RED" ? RED_PIECE_CHARS[type] : BLACK_PIECE_CHARS[type];
}

const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/**
 * File number in each player's own counting (from that player's right):
 * in zh-chess board space RED file n = x + 1, BLACK file n = 9 - x
 * (verified against zh-chess `moveStr`, e.g. 炮二平五 moves the red cannon at x=1).
 */
function fileNumber(side: Side, x: number): number {
	return side === "RED" ? x + 1 : 9 - x;
}

function fileText(side: Side, x: number): string {
	const n = fileNumber(side, x);
	return side === "RED" ? CHINESE_DIGITS[n] : String(n);
}

function stepText(side: Side, steps: number): string {
	return side === "RED" ? CHINESE_DIGITS[steps] : String(steps);
}

/** RED advances toward y=0, BLACK toward y=9. */
function isForward(side: Side, fromY: number, toY: number): boolean {
	return side === "RED" ? toY < fromY : toY > fromY;
}

const DIAGONAL_MOVERS: ReadonlySet<BoardPiece["type"]> = new Set(["horse", "elephant", "advisor"]);

/**
 * Traditional Chinese move notation (纵线记法), e.g. 炮二平五 / 马8进7 / 前车退二.
 * Follows the common convention: red files in Chinese numerals, black in Arabic;
 * 前/中/后 disambiguate same pieces stacked on one file.
 */
export function toChineseNotation(pieces: readonly BoardPiece[], from: BoardPoint, to: BoardPoint, side: Side): string {
	const mover = pieces.find((p) => p.x === from.x && p.y === from.y && p.side === side);
	if (!mover) return moveToIccs(from, to);
	const char = pieceChar(side, mover.type);

	const stacked = pieces
		.filter((p) => p.side === side && p.type === mover.type && p.x === from.x)
		.sort((a, b) => (side === "RED" ? a.y - b.y : b.y - a.y)); // front (closest to enemy) first

	let head: string;
	if (stacked.length <= 1) {
		head = `${char}${fileText(side, from.x)}`;
	} else {
		const index = stacked.findIndex((p) => p.y === from.y);
		const label =
			stacked.length === 2
				? ["前", "后"][index]
				: stacked.length === 3
					? ["前", "中", "后"][index]
					: index === 0
						? "前"
						: index === stacked.length - 1
							? "后"
							: CHINESE_DIGITS[index + 1];
		head = `${label}${char}`;
	}

	if (to.y === from.y) return `${head}平${fileText(side, to.x)}`;
	const direction = isForward(side, from.y, to.y) ? "进" : "退";
	if (DIAGONAL_MOVERS.has(mover.type)) return `${head}${direction}${fileText(side, to.x)}`;
	return `${head}${direction}${stepText(side, Math.abs(to.y - from.y))}`;
}
