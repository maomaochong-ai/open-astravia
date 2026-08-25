import { XiangqiEngine } from "./engine";
import { parseIccs } from "./notation";
import type { MoveRecord } from "./types";

const initialLayout = (): Map<string, string> => {
	const map = new Map<string, string>();
	for (const piece of new XiangqiEngine().pieces()) {
		// The starting square is a stable identity for the whole game.
		map.set(`${piece.x},${piece.y}`, `${piece.side}:${piece.type}:${piece.x},${piece.y}`);
	}
	return map;
};

/**
 * Stable piece ids for move animation: replay the coordinate history from the
 * initial layout so a moving piece keeps its React key while sliding.
 * Returns a map of `"x,y"` → id for the current position.
 */
export function trackPieceIds(moves: readonly MoveRecord[]): Map<string, string> {
	const map = initialLayout();
	for (const move of moves) {
		const parsed = parseIccs(move.iccs);
		if (!parsed) break;
		const fromKey = `${parsed.from.x},${parsed.from.y}`;
		const toKey = `${parsed.to.x},${parsed.to.y}`;
		const id = map.get(fromKey);
		if (!id) break;
		map.delete(fromKey);
		map.set(toKey, id);
	}
	return map;
}
