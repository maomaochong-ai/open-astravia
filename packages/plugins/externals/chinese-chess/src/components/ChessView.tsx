import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { parseIccs } from "../game/notation";
import { useChessRuntime } from "../runtime-context";
import { trackPieceIds } from "../game/piece-tracker";
import type { BoardPoint } from "../game/types";
import { opponentOf } from "../game/types";
import { Board } from "./Board";
import { NewGameScreen } from "./NewGameScreen";
import { SidePanel } from "./SidePanel";

export function ChessView(): JSX.Element {
	const { t } = useTranslation();
	const { store } = useChessRuntime();
	useEffect(() => {
		void store.ensureLoaded();
	}, [store]);
	const snap = useSyncExternalStore(
		useCallback((listener: () => void) => store.subscribe(listener), [store]),
		() => store.snapshot(),
	);
	const [selected, setSelected] = useState<BoardPoint | null>(null);

	const playerTurn = !snap.idle && !snap.status.over && !snap.agentBusy && snap.turn === snap.playerSide;
	const targets = useMemo(
		() => (selected && playerTurn ? store.legalTargetsFrom(selected) : []),
		// legal targets only change when the position (move count) changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[selected, playerTurn, snap.moves.length, store],
	);
	const pieceIds = useMemo(() => trackPieceIds(snap.moves), [snap.moves]);
	const lastMove = useMemo(() => (snap.lastMove ? parseIccs(snap.lastMove.iccs) : null), [snap.lastMove]);
	const checkedSide = snap.inCheck && !snap.status.over ? snap.turn : null;

	const handleSquareClick = useCallback(
		(point: BoardPoint): void => {
			if (!playerTurn) return;
			const piece = snap.pieces.find((p) => p.x === point.x && p.y === point.y);
			if (selected && !(selected.x === point.x && selected.y === point.y)) {
				const isTarget = targets.some((target) => target.x === point.x && target.y === point.y);
				if (isTarget) {
					setSelected(null);
					void store.playerMove(selected, point);
					return;
				}
			}
			if (piece && piece.side === snap.playerSide) {
				setSelected(selected && selected.x === point.x && selected.y === point.y ? null : point);
				return;
			}
			setSelected(null);
		},
		[playerTurn, selected, targets, snap.pieces, snap.playerSide, store],
	);

	if (!snap.loaded) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
				{t("chess.loading")}
			</div>
		);
	}

	if (snap.idle) {
		return (
			<div className="h-full overflow-y-auto bg-[var(--background)]">
				<NewGameScreen onStart={(side, modelKey) => void store.newGame(side, modelKey)} />
			</div>
		);
	}

	const gameOverOverlay = snap.status.over && (
		<div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
			<div className="xq-banner rounded-full border border-[var(--border)] bg-[var(--card)]/95 px-5 py-2 text-sm font-semibold shadow-lg backdrop-blur">
				{snap.status.reason === "resign"
					? t("status.resigned")
					: snap.status.winner === snap.playerSide
						? t("status.youWin")
						: t("status.youLose")}
			</div>
		</div>
	);

	return (
		<div className="flex h-full min-h-0 gap-4 overflow-hidden bg-[var(--background)] p-4">
			<div className="relative flex min-w-0 flex-[3] items-center justify-center">
				<div className="relative aspect-[672/740] max-h-full w-auto max-w-full" style={{ height: "min(100%, 82vh)" }}>
					<Board
						pieces={snap.pieces}
						playerSide={snap.playerSide}
						selected={selected}
						targets={targets}
						lastMove={lastMove}
						checkedSide={checkedSide}
						interactive={playerTurn}
						pieceIds={pieceIds}
						onSquareClick={handleSquareClick}
					/>
					{gameOverOverlay}
				</div>
			</div>
			<div className="w-80 min-w-64 max-w-96 flex-1 overflow-hidden">
				<SidePanel
					snapshot={snap}
					onUndo={() => void store.undo()}
					onResign={() => void store.resign()}
					onNewGame={() => void store.newGame(snap.playerSide === "RED" ? "RED" : "BLACK")}
					onReset={() => void store.reset()}
					onRetryAgent={() => void store.retryAgentTurn()}
					onModelChange={(modelKey) => void store.setModelKey(modelKey)}
				/>
			</div>
		</div>
	);
}
