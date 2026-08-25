import type { PluginAiChatMessage } from "@vetta-org/plugin-sdk";

export type Side = "RED" | "BLACK";

export type PieceType = "rook" | "horse" | "elephant" | "advisor" | "general" | "cannon" | "pawn";

export interface BoardPoint {
	x: number;
	y: number;
}

export interface BoardPiece {
	side: Side;
	type: PieceType;
	x: number;
	y: number;
}

/** One half-move as recorded in the game history. */
export interface MoveRecord {
	/** Coordinate notation, e.g. `"b7e7"` (files a-i = x 0-8, ranks 0-9 = y). */
	iccs: string;
	side: Side;
	/** Traditional Chinese notation, e.g. `炮二平五`. */
	notation: string;
	capturedType?: PieceType;
	/** The move put the opponent in check. */
	check: boolean;
}

export interface GameStatus {
	over: boolean;
	winner: Side | null;
	reason?: "checkmate" | "resign";
}

/** One assistant commentary line shown in the chat panel. */
export interface CommentaryEntry {
	/** Index into `moves` of the agent move this commentary accompanied. */
	moveIndex: number;
	text: string;
}

export interface PersistedGameState {
	version: 1;
	/** PEN (xiangqi FEN) of the current position, including the side to move. */
	pen: string;
	playerSide: Side;
	moves: MoveRecord[];
	/** Full ai.chat transcript owned by the plugin (the host keeps no chat state). */
	chat: PluginAiChatMessage[];
	commentary: CommentaryEntry[];
	modelKey: string | null;
	status: GameStatus;
	updatedAt: number;
}

export function opponentOf(side: Side): Side {
	return side === "RED" ? "BLACK" : "RED";
}

export const INITIAL_PEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";
