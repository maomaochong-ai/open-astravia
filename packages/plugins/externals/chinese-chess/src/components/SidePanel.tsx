import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useEffect, useRef } from "react";
import type { ChessSnapshot } from "../game/store";
import { pieceChar } from "../game/notation";
import type { PieceType, Side } from "../game/types";
import { opponentOf } from "../game/types";
import { ConfirmButton } from "./ConfirmButton";
import { ModelPicker } from "./ModelPicker";

interface SidePanelProps {
	snapshot: ChessSnapshot;
	onUndo(): void;
	onResign(): void;
	onNewGame(): void;
	onReset(): void;
	onRetryAgent(): void;
	onModelChange(modelKey: string | null): void;
}

function SideDot({ side }: { side: Side }): JSX.Element {
	return (
		<span
			className={[
				"inline-block size-2.5 rounded-full",
				side === "RED" ? "bg-[#c0392b]" : "bg-[#2f2a26] ring-1 ring-[var(--border)]",
			].join(" ")}
		/>
	);
}

function CapturedTray({ label, types, side }: { label: string; types: PieceType[]; side: Side }): JSX.Element {
	return (
		<div className="flex min-h-7 flex-wrap items-center gap-1">
			<span className="mr-1 text-[11px] text-[var(--muted-foreground)]">{label}</span>
			{types.map((type, i) => (
				<span
					key={`${type}-${i}`}
					className={[
						"xq-cal inline-flex size-6 items-center justify-center rounded-full border text-[13px]",
						side === "RED"
							? "border-[#c0392b66] bg-[#c0392b14] text-[#c0392b]"
							: "border-[var(--border)] bg-[var(--accent)] text-[var(--foreground)]",
					].join(" ")}
				>
					{pieceChar(side, type)}
				</span>
			))}
		</div>
	);
}

export function SidePanel(props: SidePanelProps): JSX.Element {
	const { t } = useTranslation();
	const snap = props.snapshot;
	const agentSide = opponentOf(snap.playerSide);
	const movesRef = useRef<HTMLDivElement | null>(null);
	const chatRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const el = movesRef.current;
		if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
	}, [snap.moves.length]);
	useEffect(() => {
		const el = chatRef.current;
		if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [snap.commentary.length]);

	const playerInCheck = snap.inCheck && snap.turn === snap.playerSide && !snap.status.over;
	const agentStalled = !snap.status.over && !snap.agentBusy && snap.turn === agentSide;

	let statusText: string;
	let statusTone = "text-[var(--foreground)]";
	if (snap.status.over) {
		if (snap.status.reason === "resign") {
			statusText = t("status.resigned");
			statusTone = "text-[var(--muted-foreground)]";
		} else if (snap.status.winner === snap.playerSide) {
			statusText = t("status.youWin");
			statusTone = "text-emerald-500";
		} else {
			statusText = t("status.youLose");
			statusTone = "text-red-500";
		}
	} else if (snap.agentBusy) {
		statusText = t("status.thinking");
		statusTone = "text-[var(--muted-foreground)]";
	} else if (snap.turn === snap.playerSide) {
		statusText = t("status.yourTurn");
	} else {
		statusText = t("status.thinking");
		statusTone = "text-[var(--muted-foreground)]";
	}

	const captures = (bySide: Side): PieceType[] =>
		snap.moves
			.filter((move) => move.side === bySide && move.capturedType !== undefined)
			.map((move) => move.capturedType as PieceType);

	return (
		<div className="flex h-full w-full flex-col gap-3">
			{/* status */}
			<div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<SideDot side={snap.turn} />
						<span className={`text-sm font-medium ${statusTone}`}>{statusText}</span>
						{snap.agentBusy && (
							<span className="ml-1 inline-flex gap-0.5" aria-label="thinking">
								<span className="xq-think-dot size-1.5 rounded-full bg-[var(--muted-foreground)]" />
								<span className="xq-think-dot size-1.5 rounded-full bg-[var(--muted-foreground)]" />
								<span className="xq-think-dot size-1.5 rounded-full bg-[var(--muted-foreground)]" />
							</span>
						)}
					</div>
					{playerInCheck && (
						<span className="xq-banner rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-500">
							{t("status.check")}
						</span>
					)}
				</div>
				<div className="mt-2 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
					<SideDot side={snap.playerSide} />
					<span>
						{t(snap.playerSide === "RED" ? "side.red" : "side.black")} · {t("moveNumber", { count: snap.moves.length })}
					</span>
				</div>
			</div>

			{/* commentary */}
			<div className="flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]">
				<div className="border-b border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)]">
					{t("panel.commentary")}
				</div>
				<div ref={chatRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
					{snap.commentary.length === 0 ? (
						<div className="px-1 text-xs text-[var(--muted-foreground)]">{t("panel.emptyCommentary")}</div>
					) : (
						snap.commentary.map((entry) => (
							<div key={entry.moveIndex} className="xq-bubble flex items-start gap-2">
								<span
									className={[
										"xq-cal mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
										agentSide === "RED" ? "bg-[#c0392b1a] text-[#c0392b]" : "bg-[var(--accent)] text-[var(--foreground)]",
									].join(" ")}
								>
									{agentSide === "RED" ? "帅" : "将"}
								</span>
								<div className="max-w-full rounded-lg rounded-tl-sm bg-[var(--accent)] px-3 py-2 text-[13px] leading-relaxed text-[var(--foreground)]">
									{entry.text}
									<span className="ml-1.5 text-[11px] text-[var(--muted-foreground)]">
										{snap.moves[entry.moveIndex]?.notation}
									</span>
								</div>
							</div>
						))
					)}
				</div>
			</div>

			{/* moves */}
			<div className="flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]">
				<div className="border-b border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)]">
					{t("panel.moves")}
				</div>
				<div ref={movesRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
					{snap.moves.length === 0 ? (
						<div className="px-1 py-1 text-xs text-[var(--muted-foreground)]">{t("panel.noMoves")}</div>
					) : (
						<ol className="space-y-0.5 text-[13px]">
							{snap.moves.map((move, index) => (
								<li
									key={`${index}-${move.iccs}`}
									className={[
										"flex items-center gap-2 rounded-md px-2 py-1",
										index === snap.moves.length - 1 ? "bg-[var(--accent)]" : "",
									].join(" ")}
								>
									<span className="w-7 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">
										{index + 1}.
									</span>
									<SideDot side={move.side} />
									<span className="xq-cal text-[var(--foreground)]">{move.notation}</span>
									{move.capturedType !== undefined && (
										<span className="text-[11px] text-amber-600">
											吃{pieceChar(opponentOf(move.side), move.capturedType)}
										</span>
									)}
									{move.check && <span className="text-[11px] font-semibold text-red-500">将</span>}
								</li>
							))}
						</ol>
					)}
				</div>
				<div className="space-y-1 border-t border-[var(--border)] px-4 py-2">
					<CapturedTray label={t("panel.captured")} types={captures(snap.playerSide)} side={agentSide} />
					<CapturedTray label={t("panel.captured")} types={captures(agentSide)} side={snap.playerSide} />
				</div>
			</div>

			{/* controls */}
			<div className="flex flex-wrap items-center gap-2">
				{snap.status.over ? (
					<button
						type="button"
						className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90"
						onClick={props.onNewGame}
					>
						{t("action.playAgain")}
					</button>
				) : (
					<>
						<button
							type="button"
							disabled={snap.agentBusy || snap.moves.length === 0}
							className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
							onClick={props.onUndo}
						>
							{t("action.undo")}
						</button>
						<ConfirmButton
							label={t("action.resign")}
							confirmLabel={t("confirm.resign")}
							disabled={snap.agentBusy}
							onConfirm={props.onResign}
						/>
						{agentStalled && (
							<button
								type="button"
								className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-500/20"
								onClick={props.onRetryAgent}
							>
								{t("action.retryAgent")}
							</button>
						)}
					</>
				)}
				<ConfirmButton label={t("action.reset")} confirmLabel={t("confirm.reset")} onConfirm={props.onReset} />
				<div className="ml-auto">
					<ModelPicker value={snap.modelKey} onChange={props.onModelChange} />
				</div>
			</div>
		</div>
	);
}
