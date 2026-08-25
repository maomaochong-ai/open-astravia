import ZhChess from "zh-chess";
import type { ChessOfPeice, PieceSide } from "zh-chess";
import { moveToIccs, toChineseNotation } from "./notation";
import type { BoardPiece, BoardPoint, MoveRecord, PieceType, Side } from "./types";
import { INITIAL_PEN, opponentOf } from "./types";

/** zh-chess uses different glyphs per side; both map onto one piece type. */
const NAME_TO_TYPE: Record<string, PieceType> = {
	车: "rook",
	車: "rook",
	马: "horse",
	馬: "horse",
	相: "elephant",
	象: "elephant",
	士: "advisor",
	仕: "advisor",
	帅: "general",
	将: "general",
	炮: "cannon",
	砲: "cannon",
	兵: "pawn",
	卒: "pawn",
};

export interface MoveOutcome {
	ok: boolean;
	/** Set when `ok` is false. */
	error?: string;
	record?: MoveRecord;
	/** Game finished by this move (checkmate / no legal reply). */
	over: boolean;
	winner: Side | null;
}

export interface LegalMove {
	from: BoardPoint;
	to: BoardPoint;
	captured: PieceType | null;
}

/**
 * Headless rules engine around zh-chess (MIT, https://github.com/kongyijilafumi/zh-chess).
 * Board space: x 0-8, y 0-9, RED back rank at y=9, RED advances toward y=0.
 * All state a caller needs to persist is the PEN string plus the move history.
 */
export class XiangqiEngine {
	private game: ZhChess;
	private turnSide: Side;
	private lastMoveGaveCheck = false;
	private overWinner: Side | null = null;

	constructor(pen?: string) {
		this.game = new ZhChess({});
		this.game.gameStart("RED");
		const source = pen ?? INITIAL_PEN;
		this.game.setPenCodeList(source);
		this.turnSide = source.trim().endsWith("b") ? "BLACK" : "RED";
		this.game.changeCurrentPlaySide(this.turnSide);
		this.game.on("move", (_pos, _cp, enemyHasTrouble) => {
			this.lastMoveGaveCheck = enemyHasTrouble;
		});
		this.game.on("over", (winner) => {
			this.overWinner = winner;
		});
	}

	get turn(): Side {
		return this.turnSide;
	}

	get pen(): string {
		return this.game.getCurrentPenCode(this.turnSide as PieceSide);
	}

	get over(): boolean {
		return this.overWinner !== null;
	}

	get winner(): Side | null {
		return this.overWinner;
	}

	pieces(): BoardPiece[] {
		return this.game.currentLivePieceList.map((piece: ChessOfPeice) => ({
			side: piece.side as Side,
			type: NAME_TO_TYPE[piece.name] ?? "pawn",
			x: piece.x,
			y: piece.y,
		}));
	}

	pieceAt(x: number, y: number): BoardPiece | null {
		return this.pieces().find((p) => p.x === x && p.y === y) ?? null;
	}

	legalMoves(side?: Side): LegalMove[] {
		if (this.over) return [];
		const forSide = side ?? this.turnSide;
		return this.game.generateLegalMoves(forSide as PieceSide).map((move) => ({
			from: { x: move.from.x, y: move.from.y },
			to: { x: move.to.x, y: move.to.y },
			captured: move.captured ? (NAME_TO_TYPE[move.captured.name] ?? "pawn") : null,
		}));
	}

	legalTargetsFrom(from: BoardPoint): BoardPoint[] {
		return this.legalMoves()
			.filter((move) => move.from.x === from.x && move.from.y === from.y)
			.map((move) => move.to);
	}

	isLegal(from: BoardPoint, to: BoardPoint): boolean {
		if (this.over) return false;
		return this.game.isLegalMove(this.turnSide as PieceSide, from, to);
	}

	/** Apply a move for the side to move. Illegal moves leave the position untouched. */
	move(from: BoardPoint, to: BoardPoint): MoveOutcome {
		if (this.over) {
			return { ok: false, error: "game over", over: true, winner: this.overWinner };
		}
		if (!this.isLegal(from, to)) {
			return { ok: false, error: "illegal move", over: false, winner: null };
		}
		const side = this.turnSide;
		const piecesBefore = this.pieces();
		const capturedType = this.pieceAt(to.x, to.y)?.type;
		const notation = toChineseNotation(piecesBefore, from, to, side);
		this.lastMoveGaveCheck = false;
		const result = this.game.update({ x: from.x, y: from.y }, { x: to.x, y: to.y }, side as PieceSide, true);
		if (!result.flag) {
			return { ok: false, error: "message" in result ? String(result.message) : "move rejected", over: false, winner: null };
		}
		this.turnSide = opponentOf(side);
		const record: MoveRecord = {
			iccs: moveToIccs(from, to),
			side,
			notation,
			...(capturedType === undefined ? {} : { capturedType }),
			check: this.lastMoveGaveCheck,
		};
		return { ok: true, record, over: this.over, winner: this.overWinner };
	}

	/** The side to move is currently in check. */
	inCheck(): boolean {
		if (this.over) return false;
		// A side is in check when the opponent could capture its general if it were
		// the opponent's turn. zh-chess exposes this via pseudo-legal generation.
		const general = this.pieces().find((p) => p.side === this.turnSide && p.type === "general");
		if (!general) return false;
		return this.game
			.generateMoves(opponentOf(this.turnSide) as PieceSide)
			.flat()
			.some((point) => point.x === general.x && point.y === general.y);
	}

	textBoard(): string {
		return this.game.exportTextBoard({ style: "chinese" });
	}
}

/** Rebuild an engine by replaying coordinate moves from the initial position. */
export function replayGame(iccsMoves: readonly string[], parse: (iccs: string) => { from: BoardPoint; to: BoardPoint } | null): XiangqiEngine {
	const engine = new XiangqiEngine();
	for (const iccs of iccsMoves) {
		const parsed = parse(iccs);
		if (!parsed) break;
		const outcome = engine.move(parsed.from, parsed.to);
		if (!outcome.ok) break;
	}
	return engine;
}
