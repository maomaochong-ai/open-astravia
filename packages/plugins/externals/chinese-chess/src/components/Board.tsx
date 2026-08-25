import type { JSX } from "react";
import { pieceChar } from "../game/notation";
import type { BoardPiece, BoardPoint, Side } from "../game/types";

const CELL = 68;
const MARGIN = 64;
const BOARD_W = CELL * 8 + MARGIN * 2;
const BOARD_H = CELL * 9 + MARGIN * 2;
const PIECE_R = 29;

interface BoardProps {
	pieces: readonly BoardPiece[];
	/** Bottom side of the rendered board (the human player). */
	playerSide: Side;
	selected: BoardPoint | null;
	targets: readonly BoardPoint[];
	lastMove: { from: BoardPoint; to: BoardPoint } | null;
	/** General of this side is currently in check. */
	checkedSide: Side | null;
	interactive: boolean;
	pieceIds: ReadonlyMap<string, string>;
	onSquareClick(point: BoardPoint): void;
}

const CHINESE_FILES = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

export function Board(props: BoardProps): JSX.Element {
	const { playerSide } = props;
	// RED at bottom: mirror x so red's file 一 sits on red's right (zh-chess convention);
	// BLACK at bottom: rotate the whole board instead.
	const toScreen = (p: BoardPoint): { c: number; r: number } =>
		playerSide === "RED" ? { c: 8 - p.x, r: p.y } : { c: p.x, r: 9 - p.y };
	const fromScreen = (c: number, r: number): BoardPoint =>
		playerSide === "RED" ? { x: 8 - c, y: r } : { x: c, y: 9 - r };
	const sx = (c: number): number => MARGIN + c * CELL;
	const sy = (r: number): number => MARGIN + r * CELL;

	const grid: JSX.Element[] = [];
	// Horizontal lines
	for (let r = 0; r < 10; r += 1) {
		grid.push(<line key={`h${r}`} x1={sx(0)} y1={sy(r)} x2={sx(8)} y2={sy(r)} />);
	}
	// Vertical lines break at the river (except the two edges)
	for (let c = 0; c < 9; c += 1) {
		if (c === 0 || c === 8) {
			grid.push(<line key={`v${c}`} x1={sx(c)} y1={sy(0)} x2={sx(c)} y2={sy(9)} />);
		} else {
			grid.push(<line key={`vt${c}`} x1={sx(c)} y1={sy(0)} x2={sx(c)} y2={sy(4)} />);
			grid.push(<line key={`vb${c}`} x1={sx(c)} y1={sy(5)} x2={sx(c)} y2={sy(9)} />);
		}
	}
	// Palace diagonals (screen rows 0-2 and 7-9, cols 3-5 in both orientations)
	for (const top of [0, 7]) {
		grid.push(<line key={`p${top}a`} x1={sx(3)} y1={sy(top)} x2={sx(5)} y2={sy(top + 2)} />);
		grid.push(<line key={`p${top}b`} x1={sx(5)} y1={sy(top)} x2={sx(3)} y2={sy(top + 2)} />);
	}

	// Cross markers on cannon/pawn starting points (board-space, orientation-independent)
	const markers: JSX.Element[] = [];
	const markPoints: BoardPoint[] = [
		{ x: 1, y: 2 },
		{ x: 7, y: 2 },
		{ x: 1, y: 7 },
		{ x: 7, y: 7 },
		...[0, 2, 4, 6, 8].flatMap((x) => [
			{ x, y: 3 },
			{ x, y: 6 },
		]),
	];
	for (const point of markPoints) {
		const { c, r } = toScreen(point);
		const cx = sx(c);
		const cy = sy(r);
		const g = 5;
		const l = 11;
		const arms: Array<[number, number]> = [];
		if (c > 0) arms.push([-1, -1], [-1, 1]);
		if (c < 8) arms.push([1, -1], [1, 1]);
		markers.push(
			<g key={`m${point.x}-${point.y}`}>
				{arms.map(([dx, dy]) => (
					<path
						key={`${dx}${dy}`}
						d={`M ${cx + dx * g} ${cy + dy * (g + l)} L ${cx + dx * g} ${cy + dy * g} L ${cx + dx * (g + l)} ${cy + dy * g}`}
						fill="none"
					/>
				))}
			</g>,
		);
	}

	// Edge labels: bottom = the player's own files in their numbering, top = opponent's.
	const labels: JSX.Element[] = [];
	for (let c = 0; c < 9; c += 1) {
		const bottomPoint = fromScreen(c, 9);
		const topPoint = fromScreen(c, 0);
		const bottomText =
			playerSide === "RED" ? CHINESE_FILES[bottomPoint.x] : String(9 - bottomPoint.x);
		const topText = playerSide === "RED" ? String(9 - topPoint.x) : CHINESE_FILES[topPoint.x];
		labels.push(
			<text key={`lb${c}`} x={sx(c)} y={BOARD_H - 20} textAnchor="middle" className="xq-cal">
				{bottomText}
			</text>,
			<text key={`lt${c}`} x={sx(c)} y={34} textAnchor="middle" className="xq-cal">
				{topText}
			</text>,
		);
	}

	const targetKeys = new Set(props.targets.map((t) => `${t.x},${t.y}`));
	const occupied = new Map(props.pieces.map((p) => [`${p.x},${p.y}`, p]));
	const lastFrom = props.lastMove ? toScreen(props.lastMove.from) : null;
	const lastTo = props.lastMove ? toScreen(props.lastMove.to) : null;
	const lastToKey = props.lastMove ? `${props.lastMove.to.x},${props.lastMove.to.y}` : null;

	return (
		<svg
			viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
			className="h-full w-full select-none"
			role="grid"
			aria-label="chinese chess board"
		>
			<defs>
				<linearGradient id="xq-frame" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#6b4423" />
					<stop offset="1" stopColor="#472a12" />
				</linearGradient>
				<linearGradient id="xq-wood" x1="0" y1="0" x2="0.15" y2="1">
					<stop offset="0" stopColor="#eed3a0" />
					<stop offset="0.5" stopColor="#e3c188" />
					<stop offset="1" stopColor="#d9b273" />
				</linearGradient>
				<radialGradient id="xq-disc" cx="0.35" cy="0.3" r="0.9">
					<stop offset="0" stopColor="#fdf3d9" />
					<stop offset="0.7" stopColor="#f3e0b4" />
					<stop offset="1" stopColor="#e2c68f" />
				</radialGradient>
			</defs>

			{/* frame + felt */}
			<rect x={0} y={0} width={BOARD_W} height={BOARD_H} rx={18} fill="url(#xq-frame)" />
			<rect x={9} y={9} width={BOARD_W - 18} height={BOARD_H - 18} rx={12} fill="url(#xq-wood)" />
			<rect
				x={9}
				y={9}
				width={BOARD_W - 18}
				height={BOARD_H - 18}
				rx={12}
				fill="none"
				stroke="#00000022"
				strokeWidth={2}
			/>

			<g stroke="#7a5230" strokeWidth={1.6} strokeLinecap="round">
				{grid}
				<rect
					x={sx(0) - 4}
					y={sy(0) - 4}
					width={CELL * 8 + 8}
					height={CELL * 9 + 8}
					fill="none"
					strokeWidth={3}
				/>
			</g>
			<g stroke="#7a5230" strokeWidth={1.4} strokeLinecap="round">
				{markers}
			</g>
			<g fill="#8a6a45" fontSize={15}>
				{labels}
			</g>

			{/* river inscription */}
			<g
				className="xq-cal"
				fill="#8a6a45"
				fontSize={30}
				textAnchor="middle"
				dominantBaseline="central"
				opacity={0.85}
			>
				<text x={sx(1) + CELL / 2} y={sy(4) + CELL / 2} letterSpacing={12}>
					楚河
				</text>
				<text x={sx(6) + CELL / 2} y={sy(4) + CELL / 2} letterSpacing={12}>
					漢界
				</text>
			</g>

			{/* click layer */}
			{Array.from({ length: 10 }, (_, r) =>
				Array.from({ length: 9 }, (_, c) => {
					const point = fromScreen(c, r);
					return (
						<rect
							key={`cell-${c}-${r}`}
							x={sx(c) - CELL / 2}
							y={sy(r) - CELL / 2}
							width={CELL}
							height={CELL}
							fill="transparent"
							role="gridcell"
							aria-label={`square-${point.x}-${point.y}`}
							data-square={`${point.x},${point.y}`}
							onClick={() => props.onSquareClick(point)}
						/>
					);
				}),
			)}

			{/* last-move trace */}
			{lastFrom && (
				<circle
					cx={sx(lastFrom.c)}
					cy={sy(lastFrom.r)}
					r={10}
					fill="none"
					stroke="#b08d57"
					strokeWidth={2.5}
					strokeDasharray="4 4"
					pointerEvents="none"
				/>
			)}
			{lastTo && (
				<rect
					x={sx(lastTo.c) - PIECE_R - 5}
					y={sy(lastTo.r) - PIECE_R - 5}
					width={(PIECE_R + 5) * 2}
					height={(PIECE_R + 5) * 2}
					rx={10}
					fill="none"
					stroke="#b08d57"
					strokeWidth={2}
					pointerEvents="none"
				/>
			)}

			{/* pieces */}
			{props.pieces.map((piece) => {
				const { c, r } = toScreen(piece);
				const key = props.pieceIds.get(`${piece.x},${piece.y}`) ?? `${piece.side}-${piece.x}-${piece.y}`;
				const isSelected = props.selected?.x === piece.x && props.selected?.y === piece.y;
				const inCheck = props.checkedSide === piece.side && piece.type === "general";
				const justMoved = lastToKey === `${piece.x},${piece.y}`;
				const red = piece.side === "RED";
				const ink = red ? "#b02b20" : "#2f2a26";
				return (
					<g
						key={key}
						className={[
							"xq-piece",
							isSelected ? "xq-piece--selected" : "",
							justMoved ? "xq-piece--landed" : "",
							props.interactive ? "" : "xq-piece--frozen",
						].join(" ")}
						style={{ transform: `translate(${sx(c)}px, ${sy(r)}px)` }}
						onClick={() => props.onSquareClick({ x: piece.x, y: piece.y })}
						role="button"
						aria-label={`${piece.side === "RED" ? "red" : "black"}-${piece.type}-${piece.x}-${piece.y}`}
					>
						<g className="xq-piece-inner">
							<g className="xq-piece-disc">
								<circle r={PIECE_R} fill={red ? "#a8342a" : "#3b352f"} />
								<circle r={PIECE_R - 2.5} fill="url(#xq-disc)" />
							</g>
							<circle r={PIECE_R - 6.5} fill="none" stroke={ink} strokeWidth={1.5} opacity={0.85} />
							<text
								className="xq-cal"
								textAnchor="middle"
								dominantBaseline="central"
								dy={1.5}
								fontSize={34}
								fontWeight={700}
								fill={ink}
							>
								{pieceChar(piece.side, piece.type)}
							</text>
							{isSelected && (
								<circle r={PIECE_R + 4} fill="none" stroke="#f5b301" strokeWidth={2.5} opacity={0.95} />
							)}
							{inCheck && <circle className="xq-check-ring" r={PIECE_R + 6} fill="none" stroke="#e5484d" />}
						</g>
					</g>
				);
			})}

			{/* legal targets */}
			{props.targets.map((target) => {
				const { c, r } = toScreen(target);
				const captures = occupied.has(`${target.x},${target.y}`);
				return captures ? (
					<circle
						key={`t${target.x}-${target.y}`}
						className="xq-target-dot"
						cx={sx(c)}
						cy={sy(r)}
						r={PIECE_R + 4}
						fill="none"
						stroke="#2f9e44"
						strokeWidth={3}
					/>
				) : (
					<circle
						key={`t${target.x}-${target.y}`}
						className="xq-target-dot"
						cx={sx(c)}
						cy={sy(r)}
						r={7.5}
						fill="#2f9e44"
					/>
				);
			})}
			{/* keep the target set keyed for tests */}
			<g data-target-count={targetKeys.size} />
		</svg>
	);
}
