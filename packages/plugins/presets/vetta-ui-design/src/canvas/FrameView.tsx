import { useTranslation } from "@vetta-org/plugin-sdk";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { BridgeHub } from "./bridge-client";
import type { FrameActivity } from "./design-runtime";

type ResizeEdge = "nw" | "ne" | "sw" | "se" | "e" | "s";

interface FrameViewProps {
	frame: VetdFrameEntry;
	port: number;
	zoom: number;
	bridge: BridgeHub;
	selected: boolean;
	/** Inspect mode: pointer events pass through to the iframe. */
	entered: boolean;
	interactive: boolean;
	/** Resize handles show only for a lone selection — a group resize has no obvious meaning. */
	resizable: boolean;
	/** false 时连 iframe 都还没挂（启动期的挂载节流），见 frame-raster.ts。 */
	mounted: boolean;
	/** false 时 iframe 收成 display:none，改用 `raster` 位图显示。 */
	live: boolean;
	raster: string | null;
	/** Live offset of the in-flight group move this frame takes part in. */
	moveDelta: { dx: number; dy: number } | null;
	activity: FrameActivity | undefined;
	onSelect(additive: boolean): void;
	onEnter(): void;
	/** Moves are owned by the canvas so every selected frame travels together. */
	onMoveStart(additive: boolean): void;
	onMoveDelta(dx: number, dy: number): void;
	onMoveEnd(): void;
	onResizeCommit(patch: Partial<Pick<VetdFrameEntry, "x" | "y" | "width" | "height">>): void;
}

interface DragState {
	pointerId: number;
	startX: number;
	startY: number;
	origin: { x: number; y: number; width: number; height: number };
	edge: ResizeEdge | "move";
}

const MIN_WIDTH = 100;
const MIN_HEIGHT = 80;

export function FrameView({
	frame,
	port,
	zoom,
	bridge,
	selected,
	entered,
	interactive,
	resizable,
	mounted,
	live,
	raster,
	moveDelta,
	activity,
	onSelect,
	onEnter,
	onMoveStart,
	onMoveDelta,
	onMoveEnd,
	onResizeCommit,
}: FrameViewProps) {
	const { t } = useTranslation();
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const dragRef = useRef<DragState | null>(null);
	/** 改尺寸拖拽期间的实时矩形（提交前不落 manifest）。 */
	const [resizeRect, setResizeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

	useEffect(() => {
		bridge.register(frame.id, iframeRef.current);
		return () => bridge.register(frame.id, null);
	}, [bridge, frame.id]);

	const rect = resizeRect ?? {
		x: frame.x + (moveDelta?.dx ?? 0),
		y: frame.y + (moveDelta?.dy ?? 0),
		width: frame.width,
		height: frame.height,
	};

	const beginDrag = (event: ReactPointerEvent, edge: DragState["edge"]): void => {
		if (!interactive || entered) return;
		event.preventDefault();
		event.stopPropagation();
		if (edge === "move") onMoveStart(event.shiftKey);
		else onSelect(false);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origin: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
			edge,
		};
	};

	const moveDrag = (event: ReactPointerEvent): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = (event.clientX - drag.startX) / zoom;
		const dy = (event.clientY - drag.startY) / zoom;
		const { origin } = drag;
		if (drag.edge === "move") {
			onMoveDelta(Math.round(dx), Math.round(dy));
			return;
		}
		let { x, y, width, height } = origin;
		if (drag.edge.includes("e")) width = origin.width + dx;
		if (drag.edge.includes("s")) height = origin.height + dy;
		if (drag.edge.includes("w")) {
			width = origin.width - dx;
			x = origin.x + dx;
		}
		if (drag.edge === "nw" || drag.edge === "ne") {
			height = origin.height - dy;
			y = origin.y + dy;
		}
		if (width < MIN_WIDTH) {
			if (drag.edge.includes("w")) x -= MIN_WIDTH - width;
			width = MIN_WIDTH;
		}
		if (height < MIN_HEIGHT) {
			if (drag.edge === "nw" || drag.edge === "ne") y -= MIN_HEIGHT - height;
			height = MIN_HEIGHT;
		}
		setResizeRect({
			x: Math.round(x),
			y: Math.round(y),
			width: Math.round(width),
			height: Math.round(height),
		});
	};

	const endDrag = (event: ReactPointerEvent): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		dragRef.current = null;
		if (drag.edge === "move") {
			onMoveEnd();
			return;
		}
		if (resizeRect) {
			onResizeCommit(resizeRect);
			setResizeRect(null);
		}
	};

	const labelScale = Math.min(1 / zoom, 8);
	const handles: { edge: ResizeEdge; className: string }[] = [
		{ edge: "nw", className: "-left-1 -top-1 cursor-nwse-resize" },
		{ edge: "ne", className: "-right-1 -top-1 cursor-nesw-resize" },
		{ edge: "sw", className: "-bottom-1 -left-1 cursor-nesw-resize" },
		{ edge: "se", className: "-bottom-1 -right-1 cursor-nwse-resize" },
		{ edge: "e", className: "-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize" },
		{ edge: "s", className: "-bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize" },
	];

	return (
		<div
			className="absolute"
			style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
			data-vetd-frame={frame.id}
		>
			{/* Title bar (inverse-scaled so it stays readable at any zoom). */}
			<div
				className="absolute left-0 flex items-center gap-1.5 whitespace-nowrap text-xs"
				style={{
					transform: `scale(${labelScale})`,
					transformOrigin: "left bottom",
					bottom: "100%",
					marginBottom: 4 * labelScale,
				}}
			>
				<button
					type="button"
					className={`cursor-pointer truncate font-medium ${
						selected ? "text-[var(--vetd-selected)]" : "text-muted-foreground"
					}`}
					onPointerDown={(event) => beginDrag(event, "move")}
					onPointerMove={moveDrag}
					onPointerUp={endDrag}
					onDoubleClick={onEnter}
					title={frame.title || frame.id}
				>
					{frame.title || frame.id}
				</button>
				<span className="text-muted-foreground">
					{rect.width}×{rect.height}
				</span>
				{activity === "modifying" ? (
					<span className="flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-primary">
						<span className="size-1.5 animate-pulse rounded-full bg-primary" />
						{t("canvas.frame.modifying")}
					</span>
				) : null}
				{activity === "updated" ? (
					<span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600">
						{t("canvas.frame.updated")}
					</span>
				) : null}
			</div>

			<div
				className={`relative h-full w-full overflow-hidden rounded-sm bg-white shadow-md ring-offset-0 ${
					selected ? "ring-2 ring-[var(--vetd-selected)]" : "ring-1 ring-border"
				} ${activity === "modifying" ? "vetd-modifying" : ""}`}
			>
				{/* 挂上之后就不再卸载：卸载会丢掉 HMR 连接，frame 会永远停在旧位图上。
				    位图态只是 display:none——渲染与合成停掉，文档与脚本照常活着。 */}
				{mounted ? (
					<iframe
						ref={iframeRef}
						title={frame.title || frame.id}
						src={`http://127.0.0.1:${port}/#/frame/${encodeURIComponent(frame.id)}`}
						className="h-full w-full border-0"
						style={{ pointerEvents: entered ? "auto" : "none", display: live ? "block" : "none" }}
					/>
				) : null}
				{!live && raster ? (
					<img src={raster} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
				) : null}
				{!live && !raster ? (
					<div className="absolute inset-0 flex items-center justify-center bg-muted">
						<span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
					</div>
				) : null}
				{/* Interaction shield: select/move at frame level until the user drills in. */}
				{!entered ? (
					// biome-ignore lint/a11y/noStaticElementInteractions: canvas manipulation surface
					<div
						className="absolute inset-0"
						style={{ cursor: interactive ? "default" : "inherit" }}
						onPointerDown={(event) => beginDrag(event, "move")}
						onPointerMove={moveDrag}
						onPointerUp={endDrag}
						onDoubleClick={(event) => {
							event.stopPropagation();
							if (interactive) onEnter();
						}}
					/>
				) : null}
			</div>

			{selected && resizable && !entered
				? handles.map(({ edge, className }) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: resize handle
						<div
							key={edge}
							className={`absolute z-10 size-2 rounded-full border border-[var(--vetd-selected)] bg-white ${className}`}
							style={{ transform: `scale(${labelScale})` }}
							onPointerDown={(event) => beginDrag(event, edge)}
							onPointerMove={moveDrag}
							onPointerUp={endDrag}
						/>
					))
				: null}
		</div>
	);
}
