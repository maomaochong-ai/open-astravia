import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { computeGraphLayout, type GraphLine } from "../../git/graphLayout";
import type { CommitNode } from "../../git/types";
import { type HostMode, useHostMode } from "../hostTheme";
import { CommitRow } from "./CommitRow";

// Geometry constants ported from Zed (crates/git_ui/src/git_graph.rs).
const ROW_HEIGHT = 24;
const LANE_WIDTH = 12;
const LEFT_PADDING = 12;
const CIRCLE_RADIUS = 3.5;
const CIRCLE_STROKE = 1.5;
const LINE_WIDTH = 1.5;
const CURVE_H = ROW_HEIGHT / 3;
const CURVE_W = LANE_WIDTH / 3;
// How far a line exits/enters a commit dot horizontally (Zed's column_shift).
const DOT_SHIFT = CIRCLE_RADIUS + CIRCLE_STROKE;
// Extra rows rendered above/below the viewport, and the bottom trigger distance.
const OVERSCAN = 8;
const REACH_END_ROWS = 16;

// One lane color per column; tuned per theme for contrast on the host background.
const LANE_COLORS: Record<HostMode, string[]> = {
	dark: ["#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#22d3ee", "#fb923c", "#a3e635"],
	light: ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#ea580c", "#65a30d"],
};
const COLORS_COUNT = LANE_COLORS.dark.length;

const laneCenterX = (lane: number): number => LEFT_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
const rowCenterY = (row: number): number => row * ROW_HEIGHT + ROW_HEIGHT / 2;

/** Build an SVG path for one edge, porting Zed's segment rendering geometry. */
function linePath(line: GraphLine): string {
	const startX = laneCenterX(line.childColumn);
	let curX = startX;
	let curY = rowCenterY(line.startRow) + CIRCLE_RADIUS;
	let d = `M${startX} ${curY}`;
	const segs = line.segments;

	segs.forEach((seg, i) => {
		const isLast = i === segs.length - 1;
		if (seg.kind === "straight") {
			let destY = rowCenterY(seg.toRow);
			if (isLast) destY -= CIRCLE_RADIUS;
			d += `L${curX} ${destY}`;
			curY = destY;
			return;
		}

		let toColX = laneCenterX(seg.toColumn);
		let toRowY = rowCenterY(seg.onRow);
		const goingRight = toColX > curX;
		const shift = goingRight ? DOT_SHIFT : -DOT_SHIFT;

		if (seg.curve === "checkout") {
			if (isLast) toColX -= shift;
			const cw = Math.min(CURVE_W, Math.abs(toColX - curX));
			const ch = Math.min(CURVE_H, Math.abs(toRowY - curY));
			const scw = goingRight ? cw : -cw;
			d += `L${curX} ${toRowY - ch}Q${curX} ${toRowY} ${curX + scw} ${toRowY}L${toColX} ${toRowY}`;
		} else {
			// merge
			if (isLast) toRowY -= CIRCLE_RADIUS;
			const msX = curX + shift;
			const msY = curY - CIRCLE_RADIUS;
			const cw = Math.min(CURVE_W, Math.abs(toColX - msX));
			const ch = Math.min(CURVE_H, Math.abs(toRowY - msY));
			const scw = goingRight ? cw : -cw;
			d += `M${msX} ${msY}L${toColX - scw} ${msY}Q${toColX} ${msY} ${toColX} ${msY + ch}L${toColX} ${toRowY}`;
		}
		curX = toColX;
		curY = toRowY;
	});

	return d;
}

/**
 * Graph renderer: a Zed-faithful swimlane layout ({@link computeGraphLayout})
 * drawn as SVG dots + edges, with HTML {@link CommitRow}s laid over it. Every
 * position is computed from row/lane (no DOM measurement), so rows stay glued to
 * their dots. Rows/dots/edges are virtualized to the scroll viewport, and reaching
 * the bottom calls {@link onReachEnd} to auto-load the next page.
 */
export function GitGraphCanvas({
	nodes,
	selectedHash,
	onSelect,
	onReachEnd,
	onContextMenu,
}: {
	nodes: readonly CommitNode[];
	selectedHash: string | null;
	onSelect: (hash: string) => void;
	onReachEnd?: () => void;
	onContextMenu?: (node: CommitNode, event: MouseEvent<HTMLElement>) => void;
}): JSX.Element {
	const mode = useHostMode();
	const layout = useMemo(() => computeGraphLayout(nodes, COLORS_COUNT), [nodes]);
	const scrollRef = useRef<HTMLDivElement>(null);
	const onReachEndRef = useRef(onReachEnd);
	onReachEndRef.current = onReachEnd;
	const [view, setView] = useState({ top: 0, height: 0 });

	// Track the scroll viewport (for virtualization) and fire onReachEnd near the bottom.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const sync = (): void => setView({ top: el.scrollTop, height: el.clientHeight });
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		let raf = 0;
		const onScroll = (): void => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				setView({ top: el.scrollTop, height: el.clientHeight });
				if (el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * REACH_END_ROWS)
					onReachEndRef.current?.();
			});
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			ro.disconnect();
			el.removeEventListener("scroll", onScroll);
			if (raf) cancelAnimationFrame(raf);
		};
	}, []);

	const colors = LANE_COLORS[mode];
	const totalHeight = nodes.length * ROW_HEIGHT;

	const first = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
	const last = Math.min(nodes.length - 1, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);

	const visibleLines = layout.lines.filter((l) => l.startRow <= last && l.endRow >= first);
	const visibleDots = layout.commits.filter((c) => c.row >= first && c.row <= last);
	const visibleRows: number[] = [];
	for (let i = first; i <= last; i++) visibleRows.push(i);

	// Size the text gutter to the lanes actually on screen (not the global max), so
	// the subject text hugs the lanes with one lane-width of breathing room.
	let visMaxLane = 0;
	for (const c of visibleDots) if (c.lane > visMaxLane) visMaxLane = c.lane;
	for (const l of visibleLines) {
		if (l.childColumn > visMaxLane) visMaxLane = l.childColumn;
		for (const s of l.segments) if (s.kind === "curve" && s.toColumn > visMaxLane) visMaxLane = s.toColumn;
	}
	const graphWidth = laneCenterX(visMaxLane) + LANE_WIDTH;

	return (
		<div ref={scrollRef} className="git-graph-canvas relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
			<svg className="pointer-events-none absolute left-0 top-0" width={graphWidth} height={totalHeight} aria-hidden>
				<title>git graph</title>
				{visibleLines.map((line) => (
					<path
						key={`${line.childColumn}_${line.startRow}_${line.endRow}`}
						d={linePath(line)}
						fill="none"
						stroke={colors[line.colorIdx % colors.length]}
						strokeWidth={LINE_WIDTH}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				))}
				{visibleDots.map((c) => (
					<circle
						key={c.hash}
						cx={laneCenterX(c.lane)}
						cy={rowCenterY(c.row)}
						r={CIRCLE_RADIUS}
						fill={colors[c.colorIdx % colors.length]}
						stroke="var(--muted)"
						strokeWidth={1}
					/>
				))}
			</svg>
			<div className="relative" style={{ height: totalHeight }}>
				{visibleRows.map((i) => {
					const node = nodes[i];
					return (
						<CommitRow
							key={node.hash}
							node={node}
							selected={node.hash === selectedHash}
							graphWidth={graphWidth}
							top={i * ROW_HEIGHT}
							height={ROW_HEIGHT}
							onContextMenu={onContextMenu}
							onSelect={onSelect}
						/>
					);
				})}
			</div>
		</div>
	);
}
